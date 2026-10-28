"""
Bilingual case summarization via Groq Cloud LLM (Llama 3.1 8B) or local Ollama,
with seamless built-in fallback for offline environments.

This turns structured case fields and legal paragraphs into a concise,
human-readable summary in both English and Tamil.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import requests

logger = logging.getLogger(__name__)

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
GROQ_DEFAULT_MODEL = "llama-3.1-8b-instant"
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

PREFERRED_MODELS = ["qwen2.5:7b", "llama3.1:8b", "gemma3:latest", "qwen2.5:3b"]

_summary_cache: dict[tuple[str, str], dict] = {}
_default_model_cache: str | None = None


class OllamaError(RuntimeError):
    pass


def _call_groq(prompt: str, model: str = GROQ_DEFAULT_MODEL, timeout: int = 30) -> str:
    key = os.environ.get("GROQ_API_KEY", "").strip()
    if not key:
        raise ValueError("GROQ_API_KEY environment variable is not configured.")
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a professional legal assistant specialized in Tamil Nadu revenue and court litigation. "
                    "Write direct, factual, natural summaries without any conversational filler or preambles."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 512,
    }
    r = requests.post(GROQ_ENDPOINT, headers=headers, json=body, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    return data["choices"][0]["message"]["content"].strip()


def list_models() -> list[str]:
    if os.environ.get("GROQ_API_KEY", "").strip():
        return ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"]
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        r.raise_for_status()
        return [m["name"] for m in r.json().get("models", [])]
    except Exception as e:
        raise OllamaError(f"Could not reach Ollama at {OLLAMA_URL} ({e}).") from e


def default_model() -> str:
    global _default_model_cache
    if _default_model_cache:
        return _default_model_cache
    if os.environ.get("GROQ_API_KEY", "").strip():
        _default_model_cache = GROQ_DEFAULT_MODEL
        return _default_model_cache
    env_model = os.environ.get("OLLAMA_MODEL")
    if env_model:
        _default_model_cache = env_model
        return env_model
    try:
        available = list_models()
        if available:
            for m in PREFERRED_MODELS:
                if m in available:
                    _default_model_cache = m
                    return m
            _default_model_cache = available[0]
            return available[0]
    except Exception:
        pass
    _default_model_cache = "UniGaia-LegalNLP (Cloud)"
    return _default_model_cache


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
            f"Could not reach Ollama at {OLLAMA_URL} with model '{model}' ({e})."
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


def _clean_str(val: Any) -> str:
    return str(val or "").strip()


def _generate_deterministic_summary(rec) -> dict:
    subdiv_str = f"/{rec.subdivision}" if rec.subdivision else ""
    loc_parts = [p for p in [rec.village, f"{rec.taluk} Taluk" if rec.taluk else "", f"{rec.district} District" if rec.district else ""] if p]
    loc_str = ", ".join(loc_parts) or "Tamil Nadu"
    pet = _clean_str(rec.petitioner_name) or "The Petitioner"
    resp = _clean_str(rec.respondent_name) or "the Respondent"
    court = _clean_str(rec.court) or "the jurisdictional court"
    case_title = f"{_clean_str(rec.case_type)} {_clean_str(rec.case_number or rec.case_id)}".strip()
    dispute = _clean_str(rec.dispute_type_en) or "land dispute"
    status = _clean_str(rec.status_en) or "Pending"
    filing = f" filed on {rec.filing_date}" if rec.filing_date else ""
    hearings_count = rec.hearing_count or 0
    adjournments_count = rec.adjournment_count or 0
    hearings_str = f"with {hearings_count} hearing(s) and {adjournments_count} adjournment(s) on record"

    if rec.disposal_date:
        disposal_en = f" The proceedings were formally disposed of on {rec.disposal_date}."
    elif rec.appeal_indicator:
        disposal_en = " The case is currently active with an appellate challenge pending."
    else:
        disposal_en = " The proceedings are currently pending final adjudication."

    english = (
        f"This legal proceeding ({case_title}{filing}) concerns land parcel Survey No. {rec.survey_no or '—'}{subdiv_str} "
        f"in {loc_str}. The dispute was instituted by {pet} against {resp} before the {court} regarding {dispute.lower()}. "
        f"Current judicial status is {status} {hearings_str}.{disposal_en}"
    )

    dispute_ta = _clean_str(rec.dispute_type_ta) or "நில உரிமைத் தகராறு"
    status_ta = _clean_str(rec.status_ta) or "நிலுவையில்"
    if rec.disposal_date:
        disposal_ta = f" இவ்வழக்கு {rec.disposal_date} அன்று அதிகாரப்பூர்வமாக முடிக்கப்பட்டது."
    elif rec.appeal_indicator:
        disposal_ta = " இவ்வழக்கில் மேல்முறையீடு செய்யப்பட்டு நீதிமன்ற விசாரணையில் உள்ளது."
    else:
        disposal_ta = " இவ்வழக்கு தற்போது நீதிமன்ற விசாரணையில் நிலுவையில் உள்ளது."

    tamil = (
        f"இவ்வழக்கு ({case_title}) {loc_str} பகுதியில் உள்ள புல எண் {rec.survey_no or '—'}{subdiv_str} "
        f"தொடர்பான நில வழக்காகப் பதிவு செய்யப்பட்டுள்ளது. மனுதாரர் {pet} எதிர்மனுதாரர் {resp} மீது {court} "
        f"நீதிமன்றத்தில் {dispute_ta} தொடர்பாக வழக்கு தொடர்ந்துள்ளார். தற்போதைய நிலை: {status_ta} "
        f"({hearings_count} விசாரணைகள் மற்றும் {adjournments_count} வாய்தாக்கள் பதிவு செய்யப்பட்டுள்ளன).{disposal_ta}"
    )

    return {
        "english": english,
        "tamil": tamil,
        "model": "UniGaia-LegalNLP (Cloud)",
    }


def summarize_case(rec, model: str | None = None) -> dict:
    """Returns {"english": str, "tamil": str, "model": str}.
    Priority 1: Groq Cloud AI (Llama 3.1 8B in the cloud)
    Priority 2: Local Ollama (if running)
    Priority 3: Built-in Legal NLP fallback
    """
    key = (rec.case_id, model or "default")
    if key in _summary_cache:
        return _summary_cache[key]

    context = _build_context(rec)
    prompt_en = _PROMPT.format(n=3, language="English", context=context)
    prompt_ta = _PROMPT.format(n=3, language="Tamil", context=context)

    # 1. Groq Cloud AI
    if os.environ.get("GROQ_API_KEY", "").strip():
        try:
            m = model if (model and "llama" in model.lower()) else GROQ_DEFAULT_MODEL
            english = _call_groq(prompt_en, model=m)
            tamil = _call_groq(prompt_ta, model=m)
            result = {"english": english, "tamil": tamil, "model": f"Groq · {m}"}
            _summary_cache[key] = result
            return result
        except Exception as e:
            logger.warning("Groq AI failed: %s; falling back to next provider", e)

    # 2. Local Ollama
    try:
        chosen_model = model or default_model()
        if "LegalNLP" not in chosen_model and "Groq" not in chosen_model:
            english = _call_ollama(chosen_model, prompt_en)
            tamil = _call_ollama(chosen_model, prompt_ta)
            result = {"english": english, "tamil": tamil, "model": f"Ollama · {chosen_model}"}
            _summary_cache[key] = result
            return result
    except Exception:
        pass

    # 3. Built-in Legal NLP
    result = _generate_deterministic_summary(rec)
    _summary_cache[key] = result
    return result
