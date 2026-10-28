"""
HTTP layer for the risk module.  main.py only needs:

    from .risk.api import attach_risk, risk_engine
    attach_risk(app, get_by_id=lambda: _BY_ID, reload_index=lambda: _load())
    ... and  risk_engine.fit(_RECORDS)  at the end of _load()
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from ..summarizer import OllamaError
from .engine import RiskEngine
from .explain import explain_case

risk_engine = RiskEngine()

# Change to "REAL" (or remove) once the PDFs under data/pdf are real court documents.
TRAINING_DATA_PROVENANCE = "SYNTHETIC"

_FRONTEND_JS = Path(__file__).resolve().parents[2] / "frontend" / "risk.js"

router = APIRouter(prefix="/risk", tags=["risk"])
_get_by_id = lambda: {}
_reload_index = lambda: None


def _need_ready():
    if not risk_engine.ready:
        raise HTTPException(503, "Risk models are not trained: " + (risk_engine.error or "still starting up"))


def _decorate(pred: dict) -> dict:
    rec = _get_by_id().get(pred["case_id"])
    d = dict(pred)
    if rec is not None:
        d.update({"survey_no": rec.survey_no, "subdivision": rec.subdivision,
                  "dispute_type": rec.dispute_type_en, "court": rec.court})
    d["training_data_provenance"] = TRAINING_DATA_PROVENANCE
    return d


@router.get("/model")
def model_info():
    """What the models were trained on, cross-validated quality, warnings."""
    return {**risk_engine.model_info(), "training_data_provenance": TRAINING_DATA_PROVENANCE}


@router.get("/cases")
def all_cases(band: str | None = Query(None, description="Low | Medium | High | Closed"),
              min_score: float | None = None,
              sort: str = Query("score_desc", description="score_desc | score_asc")):
    _need_ready()
    items = risk_engine.all()
    if band:
        items = [p for p in items if (p.get("risk_band") or "").lower() == band.lower()]
    if min_score is not None:
        items = [p for p in items if p.get("risk_score") is not None and p["risk_score"] >= min_score]
    scored = sorted((p for p in items if p.get("risk_score") is not None),
                    key=lambda p: p["risk_score"], reverse=(sort != "score_asc"))
    items = scored + [p for p in items if p.get("risk_score") is None]
    return {"count": len(items), "cases": [_decorate(p) for p in items]}


@router.get("/batch")
def batch(case_ids: str = Query(..., description="comma-separated case ids")):
    """Used by the dashboard: predictions for exactly the cases currently on screen."""
    _need_ready()
    out = {}
    for cid in [c.strip() for c in case_ids.split(",") if c.strip()]:
        p = risk_engine.get(cid)
        if p:
            out[cid] = _decorate(p)
    return {"predictions": out, "model": {
        "trained_at": risk_engine.info.get("trained_at"),
        "duration_reliability": risk_engine.info["duration_model"]["reliability"],
        "appeal_reliability": risk_engine.info["appeal_model"]["reliability"],
        "warnings": risk_engine.info.get("warnings", [])}}


@router.get("/cases/{case_id}")
def one_case(case_id: str):
    _need_ready()
    p = risk_engine.get(case_id)
    if not p:
        raise HTTPException(404, "Case not found")
    return _decorate(p)


@router.get("/cases/{case_id}/explain")
def explain(case_id: str, model: str | None = None):
    """English + Tamil plain-language explanation written by Ollama from the
    model's own numbers (the LLM computes nothing)."""
    _need_ready()
    p, rec = risk_engine.get(case_id), _get_by_id().get(case_id)
    if not p or rec is None:
        raise HTTPException(404, "Case not found")
    try:
        r = explain_case(rec, p, risk_engine.model_info(), model)
    except OllamaError as e:
        raise HTTPException(502, str(e))
    return {"case_id": case_id, "model": r["model"],
            "explanation": {"english": r["english"], "tamil": r["tamil"]},
            "note": "Written by a local LLM from the statistical model's numbers; the LLM did not compute them."}


@router.post("/retrain")
def retrain():
    """Re-scan data/pdf/*, rebuild the case index and retrain both models.
    Call this after adding new PDFs (or new land-record features)."""
    _reload_index()
    return model_info()


def attach_risk(app, get_by_id, reload_index):
    global _get_by_id, _reload_index
    _get_by_id, _reload_index = get_by_id, reload_index
    app.include_router(router)

    @app.get("/risk.js", include_in_schema=False)
    def risk_js():
        if not _FRONTEND_JS.exists():
            raise HTTPException(404, "frontend/risk.js not found")
        return FileResponse(_FRONTEND_JS, media_type="application/javascript")