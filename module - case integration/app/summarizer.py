"""
Bilingual case summarization via a locally-running Ollama model.

This is a SEPARATE, OPTIONAL layer on top of the deterministic PDF
extraction (extractor.py / case_record.py). It does not replace or feed
into extraction — the structured fields you already get from /cases/{id}
are 100%-validated regex extraction with zero AI involved (see README).
This module only turns that already-extracted, already-verified data into
a short human-readable paragraph, using whatever model you have pulled in
Ollama. If Ollama is down, unreachable, or the model isn't pulled, every
function here raises OllamaError with a message that tells the caller (or
you, reading the FastAPI error) exactly what to check.

Why the summary is built FROM the structured fields + the English
paragraphs, not from the raw Tamil paragraph text: the Tamil PDFs have a
known font-subset defect (see extractor.py) that drops some words/letters
from their own text layer. Summarizing that raw text would risk baking
missing/garbled words into the summary. Instead we hand the model the
already-corrected structured facts (case_record.py already resolved
English-vs-Tamil conflicts) plus the reliable English narrative, and ask
the model for two summaries - one written in English, one written in
Tamil - so the Tamil output is a fresh, correct rendering rather than a
summary of potentially-corrupted source text.
"""
from __future__ import annotations

import os

import requests

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

# Preference order if OLLAMA_MODEL isn't set explicitly - picks the first
# of these that `ollama list` actually has pulled. Roughly best-quality
# and most reliably multilingual first, smallest/fastest last.
PREFERRED_MODELS = ["qwen2.5:7b", "llama3.1:8b", "gemma3:latest", "qwen2.5:3b"]

_summary_cache: dict[tuple[str, str], dict] = {}
_default_model_cache: str | None = None


class OllamaError(RuntimeError):
    pass


def list_models() -> list[str]:
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        r.raise_for_status()
        return [m["name"] for m in r.json().get("models", [])]
    except requests.exceptions.RequestException as e:
        raise OllamaError(
            f"Could not reach Ollama at {OLLAMA_URL} ({e}). "
            f"Is `ollama serve` running?"
        ) from e


def default_model() -> str:
    """First available model matching PREFERRED_MODELS, else whatever's
    first in `ollama list`. Cached for the process lifetime; restart the
    app if you pull/remove models and want this re-evaluated."""
    global _default_model_cache
    if _default_model_cache:
        return _default_model_cache
    env_model = os.environ.get("OLLAMA_MODEL")
    if env_model:
        _default_model_cache = env_model
        return env_model
    available = list_models()
    if not available:
        raise OllamaError("Ollama is reachable but has no models pulled (`ollama pull <model>`).")
    for m in PREFERRED_MODELS:
        if m in available:
            _default_model_cache = m
            return m
    _default_model_cache = available[0]
    return available[0]


def _call_ollama(model: str, prompt: str, timeout: int = 120) -> str:
    try:
        r = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": model, "prompt": prompt, "stream": False,
                  "options": {"temperature": 0.2}},
            timeout=timeout,
        )
        r.raise_for_status()
    except requests.exceptions.RequestException as e:
        raise OllamaError(
            f"Could not reach Ollama at {OLLAMA_URL} with model '{model}' ({e}). "
            f"Is `ollama serve` running and has `ollama pull {model}` been done?"
        ) from e
    data = r.json()
    return (data.get("response") or "").strip()


def _build_context(rec) -> str:
    en_doc = (rec.documents or {}).get("english")
    paragraphs = ""
    if en_doc and en_doc.get("paragraphs"):
        ordered = sorted(en_doc["paragraphs"].items(), key=lambda kv: int(kv[0]))
        paragraphs = "\n\n".join(f"{num}. {text}" for num, text in ordered)

    facts = "\n".join([
        f"Case ID: {rec.case_id}",
        f"Court: {rec.court}",
        f"Case type / number: {rec.case_type} {rec.case_number}",
        f"Petitioner: {rec.petitioner_name}",
        f"Respondent: {rec.respondent_name}",
        f"Survey No / Subdivision: {rec.survey_no} / {rec.subdivision}",
        f"Village / Taluk / District: {rec.village}, {rec.taluk}, {rec.district}",
        f"Dispute type: {rec.dispute_type_en}",
        f"Status: {rec.status_en}",
        f"Filing date: {rec.filing_date}",
        f"Hearing entries / Adjournment entries: {rec.hearing_count} / {rec.adjournment_count}",
        f"Appeal indicator: {rec.appeal_indicator}",
        f"Disposal date: {rec.disposal_date or 'Not disposed'}",
    ])
    return facts + ("\n\nFull case narrative:\n" + paragraphs if paragraphs else "")


_PROMPT = """The following is SYNTHETIC test data for a land-litigation case retrieval \
system - it is not a real court record. Using ONLY the facts given below, write a \
concise {n}-sentence summary in {language} covering: who the parties are, the survey \
number and land location, the dispute type, the court, the current status, and the \
hearing/adjournment history. Do not invent any fact that is not stated below. Do not \
add a heading, a disclaimer, or any text other than the summary itself.

{context}

{language} summary:"""


def summarize_case(rec, model: str | None = None) -> dict:
    """Returns {"english": str, "tamil": str, "model": str}. Cached per
    (case_id, model) for the process lifetime."""
    model = model or default_model()
    key = (rec.case_id, model)
    if key in _summary_cache:
        return _summary_cache[key]

    context = _build_context(rec)
    english = _call_ollama(model, _PROMPT.format(n=3, language="English", context=context))
    tamil = _call_ollama(model, _PROMPT.format(n=3, language="Tamil", context=context))

    result = {"english": english, "tamil": tamil, "model": model}
    _summary_cache[key] = result
    return result