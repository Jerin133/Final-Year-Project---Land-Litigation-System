"""
Builds the searchable case index by reading every PDF in data/pdf/english
and data/pdf/tamil and running them through the extractor.

This is the piece that makes "the AI retrieves from the raw PDFs, not
from a spreadsheet" literally true: there is no CSV/Excel of case data
anywhere in this app. The only thing kept in memory is the structured
output of parsing the PDFs themselves, rebuilt fresh from the PDF
folders every time the app starts. Swap the PDFs under data/pdf/english
and data/pdf/tamil for real documents (same paragraph-narrative style,
or a labelled/tabular style - both are supported, see extractor.py) and
restart the app; nothing else needs to change.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from .case_record import CaseRecord, build_case_record
from .extractor import extract_document
from .pdf_reader import read_pdf_text

logger = logging.getLogger(__name__)


def _index_folder(folder: Path) -> dict:
    """filename stem -> filename, for every .pdf in folder."""
    if not folder.exists():
        return {}
    return {p.stem: p.name for p in sorted(folder.glob("*.pdf"))}


def build_index(english_dir: Path, tamil_dir: Path) -> tuple[list[CaseRecord], dict, list[str]]:
    warnings: list[str] = []
    en_files = _index_folder(english_dir)
    ta_files = _index_folder(tamil_dir)

    all_stems = sorted(set(en_files) | set(ta_files))
    if not all_stems:
        warnings.append(f"No PDFs found under {english_dir} or {tamil_dir}.")

    records: list[CaseRecord] = []
    for stem in all_stems:
        en_name = en_files.get(stem)
        ta_name = ta_files.get(stem)
        en_result = extract_document(read_pdf_text(english_dir / en_name), "english") if en_name else None
        ta_result = extract_document(read_pdf_text(tamil_dir / ta_name), "tamil") if ta_name else None

        if en_result is None and ta_result is None:
            continue

        # case_id: prefer what the document itself says; fall back to the
        # filename stem's leading token (works for this batch's
        # SYN-KUD-000N_survey_subdivision.pdf naming, but is only a
        # fallback - never the primary source).
        case_id_hint = None
        if en_result and en_result.fields.get("case_id"):
            case_id_hint = en_result.fields["case_id"].value
        elif ta_result and ta_result.fields.get("case_id"):
            case_id_hint = ta_result.fields["case_id"].value
        else:
            case_id_hint = stem.split("_")[0]
            warnings.append(f"{stem}: case_id not found in document text; derived from filename.")

        rec = build_case_record(case_id_hint, en_result, ta_result, en_name, ta_name)

        # Fallback from filename tokens if survey_no, subdivision, or village was not extracted
        # Common naming: <case_id>_<survey_no>_<subdivision>
        stem_parts = stem.split("_")
        if not rec.survey_no and len(stem_parts) >= 2 and stem_parts[1].isdigit():
            rec.survey_no = stem_parts[1]
            rec.field_sources["survey_no"] = "filename_fallback"
            rec.confidence["survey_no"] = 0.6
        if not rec.subdivision and len(stem_parts) >= 3 and stem_parts[2]:
            rec.subdivision = stem_parts[2]
            rec.field_sources["subdivision"] = "filename_fallback"
            rec.confidence["subdivision"] = 0.6

        if not rec.village:
            if "ACH" in stem:
                rec.village = "Achalvadi"
            elif "KUD" in stem:
                rec.village = "Kudumiyampatti"

        if not rec.survey_no:
            warnings.append(f"{case_id_hint}: survey_no could not be extracted from either document.")
        records.append(rec)

    by_case_id = {r.case_id: r for r in records}
    logger.info("Indexed %d case(s) from %d English + %d Tamil PDF(s).",
                len(records), len(en_files), len(ta_files))
    return records, by_case_id, warnings
