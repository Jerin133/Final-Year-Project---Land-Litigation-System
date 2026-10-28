"""
Plain-language explanation of a risk estimate, written by the local Ollama
model (same server/model selection as the Module 2 summariser).

The LLM does NOT compute anything.  The numbers come from the statistical
models in engine.py; the LLM is only asked to put those exact numbers and
factors into readable English and Tamil.  Everything is pre-formatted
(percentages, months, dates) so the model never has to do arithmetic.
"""
from __future__ import annotations

from ..summarizer import OllamaError, _call_ollama, default_model

_cache: dict = {}

_LEVEL = {"weak": "LOW (treat as rough)", "moderate": "MODERATE", "good": "GOOD", "unknown": "UNKNOWN"}


def _fmt_drivers(items, kind):
    out = []
    for d in items:
        if kind == "duration":
            out.append(f"- {d['factor']}: {d['effect']} the expected duration by about "
                       f"{abs(d['change_in_expected_duration_pct'])}%")
        else:
            out.append(f"- {d['factor']}: {d['effect']} the odds of an appeal "
                       f"(x{d['odds_multiplier']})")
    return "\n".join(out) or "- none stand out"


def build_context(rec, pred, model_info) -> str:
    if pred.get("mode") != "predicted":
        ec = pred.get("expected_completion") or {}
        return (f"Case {rec.case_id}, survey {rec.survey_no}/{rec.subdivision}, dispute: {rec.dispute_type_en}, "
                f"court: {rec.court}. Status: {pred.get('status')}. This case is closed - no prediction is made. "
                f"Actual disposal date: {ec.get('actual_disposal_date') or 'unknown'}; "
                f"actual duration: {ec.get('actual_duration_days') or 'unknown'} days.")
    ec = pred["expected_completion"]
    rng = ec["range_80pct"]
    prol = ("ALREADY exceeded the long-case threshold (%d days)" % pred["prolonged_threshold_days"]
            if pred.get("already_prolonged") else f"{round(pred['prolonged_probability'] * 100)}%")
    app = ("An appeal has ALREADY been filed" if pred.get("appeal_already_filed")
           else f"{round(pred['appeal_probability'] * 100)}%")
    dur_q = _LEVEL.get(model_info.get("duration_model", {}).get("reliability"), "UNKNOWN")
    app_q = _LEVEL.get(model_info.get("appeal_model", {}).get("reliability"), "UNKNOWN")
    return "\n".join([
        f"Case: {rec.case_id} | Survey {rec.survey_no}/{rec.subdivision} | {rec.dispute_type_en} | {rec.court}",
        f"Status: {pred['status']} | running for {round(pred['case_age_days'] / 365.25, 1)} years",
        f"Risk score: {pred['risk_score']} out of 100 ({pred['risk_band']} risk; riskier than "
        f"{pred.get('risk_percentile_among_open_cases', '?')}% of other open cases)",
        f"Probability of prolonged litigation: {prol}",
        f"Probability of appeal: {app}",
        f"Expected completion: about {ec['median_remaining_months']} months from now "
        f"(around {ec['expected_date']}); 80% range {rng['earliest_date']} to {rng['latest_date']}",
        f"Estimate caveat: {ec.get('note') or 'none'}",
        "Factors affecting duration:\n" + _fmt_drivers(pred["drivers"]["duration"], "duration"),
        "Factors affecting appeal:\n" + _fmt_drivers(pred["drivers"]["appeal"], "appeal"),
        f"Model reliability - duration: {dur_q}; appeal: {app_q}. "
        f"Trained on {model_info.get('cases_total')} cases.",
    ])


_PROMPT = """You are explaining a statistical litigation-risk estimate for a land-dispute case \
to a village-level revenue administrator. Use ONLY the facts below. Do not invent facts, \
do not give legal advice, do not predict who will win. Write exactly {n} short sentences \
in {language}, covering: the risk level and score, the chance of prolonged litigation, the \
chance of appeal, the expected completion time, and the one or two most important factors. \
Finish by saying this is a statistical estimate from similar cases and that its reliability is \
as stated below. Copy numbers and dates exactly. No heading, no bullet points, no preamble.

{context}

{language} explanation:"""


def explain_case(rec, pred, model_info, model=None) -> dict:
    model = model or default_model()
    key = (rec.case_id, model, model_info.get("trained_at"))
    if key in _cache:
        return _cache[key]
    ctx = build_context(rec, pred, model_info)
    result = {
        "english": _call_ollama(model, _PROMPT.format(n=4, language="English", context=ctx)),
        "tamil": _call_ollama(model, _PROMPT.format(n=4, language="Tamil", context=ctx)),
        "model": model,
    }
    _cache[key] = result
    return result