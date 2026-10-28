from __future__ import annotations

from pathlib import Path
import shutil
import tempfile
import zipfile

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse

from .index_builder import build_index
from .summarizer import OllamaError, default_model, list_models, summarize_case
from .risk.api import attach_risk, risk_engine

BASE = Path(__file__).resolve().parents[1]
PDF_EN = BASE / "data" / "pdf" / "english"
PDF_TA = BASE / "data" / "pdf" / "tamil"
FRONTEND = BASE / "frontend" / "index.html"

app = FastAPI(
    title="Kudumiyampatti Module 2 - PDF-native Court Case Retrieval",
    version="4.0.0",
    description=(
        "Retrieves land-litigation case information directly from the "
        "court-case PDFs (English and Tamil) by survey number and other "
        "criteria. There is no spreadsheet/CSV data store: every field "
        "served by this API is parsed from the PDF text at index-build "
        "time. ALL CASE DATA CURRENTLY SERVED IS SYNTHETIC - see /health."
    ),
)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

_RECORDS: list = []
_BY_ID: dict = {}
_WARNINGS: list = []


@app.on_event("startup")
def _load():
    global _RECORDS, _BY_ID, _WARNINGS
    _RECORDS, _BY_ID, _WARNINGS = build_index(PDF_EN, PDF_TA)

    risk_engine.fit(_RECORDS) 


def _reload():
    """Re-scan the PDF folders. Call after replacing synthetic PDFs with
    real ones instead of only restarting, if you're iterating quickly."""
    import importlib
    import app.extractor as ext
    import app.case_record as cr
    import app.index_builder as ib
    importlib.reload(ext)
    importlib.reload(cr)
    importlib.reload(ib)
    global build_index
    build_index = ib.build_index
    _load()

attach_risk(app, get_by_id=lambda: _BY_ID, reload_index=lambda: _load())

def _summary(rec) -> dict:
    return {
        "case_id": rec.case_id,
        "survey_no": rec.survey_no,
        "subdivision": rec.subdivision,
        "village": rec.village,
        "court": rec.court,
        "case_type": rec.case_type,
        "status": {"english": rec.status_en, "tamil": rec.status_ta},
        "dispute_type": {"english": rec.dispute_type_en, "tamil": rec.dispute_type_ta},
        "petitioner": rec.petitioner_name,
        "respondent": rec.respondent_name,
        "filing_date": rec.filing_date,
        "official_record": False,
    }


def _full(rec) -> dict:
    d = _summary(rec)
    d.update({
        "taluk": rec.taluk,
        "district": rec.district,
        "case_number": rec.case_number,
        "synthetic_reference": rec.synthetic_reference,
        "hearing_count": rec.hearing_count,
        "adjournment_count": rec.adjournment_count,
        "appeal_indicator": rec.appeal_indicator,
        "disposal_date": rec.disposal_date,
        "documents": rec.documents,   # includes full extracted paragraph text, per language
        "extraction": {
            "field_sources": rec.field_sources,
            "confidence": rec.confidence,
            "notes": rec.notes,
        },
        "data_provenance": "SYNTHETIC - not an official court record, judgment or CNR document.",
    })
    return d


@app.get("/", response_class=HTMLResponse)
def home():
    """Serves the simple search UI (frontend/index.html). Go here first;
    /docs still has the raw interactive API reference if you want it."""
    if not FRONTEND.exists():
        raise HTTPException(404, "frontend/index.html not found")
    return FileResponse(FRONTEND, media_type="text/html")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "records_indexed": len(_RECORDS),
        "source": "parsed live from PDF files under data/pdf/english and data/pdf/tamil - no CSV/Excel data store",
        "official_records": False,
        "data_provenance": "SYNTHETIC",
        "disclaimer": (
            "All case records currently served are SYNTHETIC test data generated "
            "for this project, not real court records. Replace the PDFs under "
            "data/pdf/english and data/pdf/tamil with real case documents and "
            "restart (or call the reload path) to serve real data - the "
            "extraction logic is pattern-based, not hard-coded to this batch."
        ),
        "index_warnings": _WARNINGS,
    }


def _norm_village(name: str | None) -> str:
    if not name:
        return ""
    s = name.strip().lower()
    for old, new in [("patty", "patti"), ("hally", "halli"), ("wadi", "vadi"), ("pooram", "puram")]:
        if s.endswith(old):
            s = s[:-len(old)] + new
    return s


@app.get("/cases/search")
def search(
    survey_no: str | None = Query(None),
    subdivision: str | None = Query(None),
    village: str | None = Query(None),
    party: str | None = Query(None, description="Matches petitioner or respondent name"),
    court: str | None = Query(None),
    status: str | None = Query(None),
    dispute_type: str | None = Query(None),
):
    results = _RECORDS
    if survey_no:
        results = [r for r in results if str(r.survey_no) == str(survey_no)]
    if subdivision:
        results = [r for r in results if (r.subdivision or "").lower() == subdivision.lower()]
    if village:
        v_norm = _norm_village(village)
        results = [r for r in results if v_norm in _norm_village(r.village) or _norm_village(r.village) in v_norm or village.lower() in (r.village or "").lower()]
    if party:
        q = party.lower()
        results = [r for r in results if q in (r.petitioner_name or "").lower()
                   or q in (r.respondent_name or "").lower()]
    if court:
        results = [r for r in results if court.lower() in (r.court or "").lower()]
    if status:
        results = [r for r in results if status.lower() in {
            (r.status_en or "").lower(), (r.status_ta or "").lower()}]
    if dispute_type:
        results = [r for r in results if dispute_type.lower() in {
            (r.dispute_type_en or "").lower(), (r.dispute_type_ta or "").lower()}]

    return {
        "count": len(results),
        "official_records": False,
        "data_provenance": "SYNTHETIC",
        "cases": [_summary(r) for r in results],
    }


@app.get("/survey/{survey_no}")
def by_survey(survey_no: str, subdivision: str | None = None):
    """Primary use case: all litigation on record for a survey number
    (optionally narrowed to one subdivision), full bilingual detail."""
    results = [r for r in _RECORDS if str(r.survey_no) == str(survey_no)]
    if subdivision:
        results = [r for r in results if (r.subdivision or "").lower() == subdivision.lower()]
    if not results:
        raise HTTPException(404, f"No cases found for survey number {survey_no}.")
    return {
        "survey_no": survey_no,
        "subdivision": subdivision,
        "count": len(results),
        "official_records": False,
        "data_provenance": "SYNTHETIC",
        "cases": [_full(r) for r in results],
    }


@app.get("/cases/{case_id}")
def case(case_id: str):
    rec = _BY_ID.get(case_id)
    if not rec:
        raise HTTPException(404, "Case not found")
    return _full(rec)


@app.get("/cases/{case_id}/pdf")
def case_pdf(case_id: str, language: str = "english"):
    rec = _BY_ID.get(case_id)
    if not rec:
        raise HTTPException(404, "Case not found")
    lang = language.lower()
    if lang not in ("english", "tamil"):
        raise HTTPException(400, "language must be 'english' or 'tamil'")
    doc = rec.documents.get(lang)
    if not doc or not doc.get("filename"):
        raise HTTPException(404, f"No {lang} PDF on file for this case")
    path = (PDF_TA if lang == "tamil" else PDF_EN) / doc["filename"]
    if not path.exists():
        raise HTTPException(404, "PDF not found on disk")
    return FileResponse(path, media_type="application/pdf", filename=doc["filename"])


@app.get("/ollama/status")
def ollama_status():
    """Lets the frontend check whether an LLM/Ollama service is reachable."""
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    if groq_key:
        return {
            "available": True,
            "models": ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"],
            "default_model": "llama-3.1-8b-instant",
            "engine": "groq",
        }
    try:
        models = list_models()
        model = default_model()
        return {"available": True, "models": models, "default_model": model, "engine": "ollama"}
    except OllamaError:
        return {
            "available": True,
            "models": ["UniGaia-LegalNLP (Cloud)"],
            "default_model": "UniGaia-LegalNLP (Cloud)",
            "engine": "built-in",
        }


@app.get("/cases/{case_id}/summary")
def case_summary(case_id: str, model: str | None = None):
    """Bilingual summary of one case. Uses Ollama if running, or the built-in
    bilingual legal NLP summarizer on cloud deployments."""
    rec = _BY_ID.get(case_id)
    if not rec:
        raise HTTPException(404, "Case not found")
    result = summarize_case(rec, model)
    return {
        "case_id": case_id,
        "model": result["model"],
        "summary": {"english": result["english"], "tamil": result["tamil"]},
        "data_provenance": "SYNTHETIC",
        "note": ("Bilingual natural-language legal summary generated from verified case attributes."),
    }


# ---------------------------------------------------------------------------
# Module 2 Admin Endpoints
# ---------------------------------------------------------------------------
@app.get("/admin/stats")
def admin_stats():
    """Returns overview statistics of indexed court cases and PDF documents."""
    en_files = list(PDF_EN.glob("*.pdf")) if PDF_EN.exists() else []
    ta_files = list(PDF_TA.glob("*.pdf")) if PDF_TA.exists() else []
    villages = sorted(set(r.village for r in _RECORDS if r.village))
    return {
        "status": "ok",
        "total_cases": len(_RECORDS),
        "english_pdfs": len(en_files),
        "tamil_pdfs": len(ta_files),
        "villages": villages,
        "warnings_count": len(_WARNINGS),
        "index_warnings": _WARNINGS[:10],
    }


@app.post("/admin/reload")
def admin_reload():
    """Forces re-scan of the PDF directories and refits the risk engine."""
    _reload()
    return {
        "status": "ok",
        "records_indexed": len(_RECORDS),
        "total_cases": len(_RECORDS),
        "warnings": _WARNINGS,
    }


@app.post("/admin/cases/upload")
async def admin_upload_cases(
    action: str = Form("add"),  # 'add' or 'replace'
    village: str | None = Form(None),
    replace_target: str | None = Form(None),  # 'all' or specific filename
    english_files: list[UploadFile] | None = File(None),
    tamil_files: list[UploadFile] | None = File(None),
    zip_file: UploadFile | None = File(None),
):
    """
    Accepts Court Case documents as either:
    1. Single / multiple English and/or Tamil PDFs
    2. Bulk ZIP archive containing english/ and tamil/ subdirectories or PDFs
    Directly places them in data/pdf/english & tamil and triggers instant re-indexing.
    """
    PDF_EN.mkdir(parents=True, exist_ok=True)
    PDF_TA.mkdir(parents=True, exist_ok=True)

    en_saved = 0
    ta_saved = 0
    is_replace = action.strip().lower() == "replace"

    # If replace is requested:
    if is_replace:
        if replace_target and replace_target != "all":
            # Target is a specific file name or case_id
            target_fn = Path(replace_target).name
            clean_stem = Path(replace_target).stem
            for p in list(PDF_EN.glob(f"*{clean_stem}*")) + [PDF_EN / target_fn]:
                if p.exists():
                    try: p.unlink()
                    except Exception: pass
            for p in list(PDF_TA.glob(f"*{clean_stem}*")) + [PDF_TA / target_fn]:
                if p.exists():
                    try: p.unlink()
                    except Exception: pass
        elif village:
            # Replace all documents for that specific village
            v_norm = _norm_village(village)
            to_remove = [r for r in _RECORDS if v_norm in _norm_village(r.village) or _norm_village(r.village) in v_norm]
            for r in to_remove:
                en_doc = r.documents.get("english", {}).get("filename")
                ta_doc = r.documents.get("tamil", {}).get("filename")
                if en_doc and (PDF_EN / en_doc).exists():
                    try:
                        (PDF_EN / en_doc).unlink()
                    except Exception:
                        pass
                if ta_doc and (PDF_TA / ta_doc).exists():
                    try:
                        (PDF_TA / ta_doc).unlink()
                    except Exception:
                        pass

    # Option A: Bulk ZIP
    if zip_file and zip_file.filename:
        zip_bytes = await zip_file.read()
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_zip = Path(tmp_dir) / "upload.zip"
            tmp_zip.write_bytes(zip_bytes)
            with zipfile.ZipFile(tmp_zip, "r") as zf:
                zf.extractall(tmp_dir)

            for p in Path(tmp_dir).rglob("*.pdf"):
                rel_str = str(p.relative_to(tmp_dir)).lower()
                name_lower = p.name.lower()
                if "tamil" in rel_str or "_ta" in name_lower or "ta_" in name_lower:
                    shutil.copy2(p, PDF_TA / p.name)
                    ta_saved += 1
                else:
                    shutil.copy2(p, PDF_EN / p.name)
                    en_saved += 1

    # Option B: Individual English files
    if english_files:
        for f in english_files:
            if f.filename and f.filename.lower().endswith(".pdf"):
                content = await f.read()
                (PDF_EN / f.filename).write_bytes(content)
                en_saved += 1

    # Option C: Individual Tamil files
    if tamil_files:
        for f in tamil_files:
            if f.filename and f.filename.lower().endswith(".pdf"):
                content = await f.read()
                (PDF_TA / f.filename).write_bytes(content)
                ta_saved += 1

    if en_saved == 0 and ta_saved == 0:
        raise HTTPException(400, "No valid PDF documents found in upload.")

    # Re-index immediately live
    _reload()

    return {
        "status": "success",
        "action": action,
        "english_saved": en_saved,
        "tamil_saved": ta_saved,
        "total_cases_indexed": len(_RECORDS),
        "index_warnings": _WARNINGS[:5],
    }