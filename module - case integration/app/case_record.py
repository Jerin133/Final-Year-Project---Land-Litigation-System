"""
Combine the English-document extraction and the Tamil-document
extraction for one case into a single bilingual record.

Rule of thumb: any field that can contain a Latin letter (case_id,
survey_no, subdivision, synthetic_reference, case_type/case_number)
is taken from the English document when it is available, because the
Tamil PDF's text layer is known to drop Latin letters from such codes
(see extractor.py docstring). Fields that are pure digits or whole
Tamil/English words are taken from whichever document has them, with
the English document preferred and the Tamil value used to
cross-check (a mismatch is recorded as a note, not silently dropped).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from .extractor import DISPUTE_TYPES_EN_TA, STATUS_EN_TA, ExtractionResult


def _clean_tamil(text):
    """Remove artificial whitespace after virama that PDF text extraction inserts
    inside compound Tamil letters. Preserves genuine word-boundary spaces."""
    if not text or not isinstance(text, str):
        return text
    s = re.sub(r'(\u0BCD)\s+(?=[\u0B80-\u0BFF])', r'\1', text)
    s = re.sub(r'([\u0B80-\u0BFF])\s+\.', r'\1.', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

# Fields where a Latin letter could appear and the Tamil text layer is
# therefore not trusted as the primary source.
_LATIN_SENSITIVE = {"case_id", "survey_no", "subdivision", "synthetic_reference",
                    "case_type", "case_number"}


@dataclass
class CaseRecord:
    case_id: Optional[str] = None
    survey_no: Optional[str] = None
    subdivision: Optional[str] = None
    patta_no: Optional[str] = None
    village: Optional[str] = None
    taluk: Optional[str] = None
    district: Optional[str] = None
    court: Optional[str] = None
    case_type: Optional[str] = None
    case_number: Optional[str] = None
    synthetic_reference: Optional[str] = None
    filing_date: Optional[str] = None
    status_en: Optional[str] = None
    status_ta: Optional[str] = None
    dispute_type_en: Optional[str] = None
    dispute_type_ta: Optional[str] = None
    hearing_count: Optional[int] = None
    adjournment_count: Optional[int] = None
    appeal_indicator: Optional[bool] = None
    disposal_date: Optional[str] = None
    petitioner_name: Optional[str] = None
    respondent_name: Optional[str] = None
    documents: dict = field(default_factory=dict)      # "english"/"tamil" -> {filename, paragraphs}
    field_sources: dict = field(default_factory=dict)   # field -> "english"/"tamil"/None
    confidence: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)


def build_case_record(case_id_hint: str,
                       english: Optional[ExtractionResult],
                       tamil: Optional[ExtractionResult],
                       english_filename: Optional[str] = None,
                       tamil_filename: Optional[str] = None) -> CaseRecord:
    rec = CaseRecord(case_id=case_id_hint)
    notes = []

    # Fields whose value is naturally written differently in each language
    # (place/court names, etc.) - a script difference here is expected, not
    # a discrepancy worth flagging.
    _TRANSLATABLE = {"village", "taluk", "district", "court"}

    def pick(field_name, prefer_latin_safe=False):
        """Return (value, source) preferring English, falling back to Tamil,
        recording a cross-check note if both exist and disagree on a
        language-neutral field (numbers, codes, dates, booleans)."""
        ev = english.fields.get(field_name) if english else None
        tv = tamil.fields.get(field_name) if tamil else None
        ev_val = ev.value if ev else None
        tv_val = tv.value if tv else None

        if prefer_latin_safe and tv_val is not None and ev_val is None:
            # Never let a Latin-sensitive field come from Tamil alone without
            # a flag - still usable (e.g. real data with only a Tamil PDF)
            # but marked lower confidence.
            return tv_val, "tamil", 0.4
        if ev_val is not None:
            if (tv_val is not None and field_name not in _TRANSLATABLE
                    and str(tv_val).strip() != str(ev_val).strip() and not prefer_latin_safe):
                notes.append(f"{field_name}: English='{ev_val}' vs Tamil='{tv_val}' (used English).")
            return ev_val, "english", ev.confidence
        if tv_val is not None:
            return tv_val, "tamil", tv.confidence
        return None, None, 0.0

    for f in ["case_id", "survey_no", "subdivision", "patta_no", "synthetic_reference",
              "case_type", "case_number", "village", "taluk", "district",
              "court", "filing_date", "hearing_count", "adjournment_count",
              "appeal_indicator", "disposal_date"]:
        val, src, conf = pick(f, prefer_latin_safe=(f in _LATIN_SENSITIVE))
        if val is not None:
            setattr(rec, f, val)
            rec.field_sources[f] = src
            rec.confidence[f] = conf

    # Ensure survey_no and subdivision are properly split if combined in either field
    if rec.subdivision and "/" in str(rec.subdivision) and not rec.survey_no:
        parts = [p.strip() for p in str(rec.subdivision).split("/", 1)]
        if len(parts) == 2 and parts[0] and parts[1]:
            rec.survey_no = parts[0]
            rec.subdivision = parts[1]
    elif rec.survey_no and "/" in str(rec.survey_no):
        parts = [p.strip() for p in str(rec.survey_no).split("/", 1)]
        if len(parts) == 2 and parts[0] and parts[1]:
            rec.survey_no = parts[0]
            if not rec.subdivision:
                rec.subdivision = parts[1]

    # status: normalise to canonical English + matching Tamil label
    status_val, status_src, status_conf = pick("status")
    if status_val:
        status_en = status_val if status_val in STATUS_EN_TA else status_val
        rec.status_en = status_en
        rec.status_ta = STATUS_EN_TA.get(status_en, status_en)
        rec.field_sources["status"] = status_src
        rec.confidence["status"] = status_conf

    # dispute_type: normalise to canonical English + matching Tamil label
    dt_val, dt_src, dt_conf = pick("dispute_type")
    if dt_val:
        dt_en = dt_val if dt_val in DISPUTE_TYPES_EN_TA else dt_val
        rec.dispute_type_en = dt_en
        rec.dispute_type_ta = DISPUTE_TYPES_EN_TA.get(dt_en, dt_en)
        rec.field_sources["dispute_type"] = dt_src
        rec.confidence["dispute_type"] = dt_conf

    # party names: prefer the English document's copy of the (Tamil-script)
    # name because it sits on a centered, non-justified line and does not
    # suffer the spurious-internal-space artefact seen in justified Tamil
    # paragraph text; fall back to the Tamil document's own copy.
    for f, attr in [("petitioner", "petitioner_name"), ("respondent", "respondent_name")]:
        ev = english.fields.get(f) if english else None
        tv = tamil.fields.get(f) if tamil else None
        if ev and ev.value:
            setattr(rec, attr, _clean_tamil(ev.value))
            rec.field_sources[f] = "english"
        elif tv and tv.value:
            setattr(rec, attr, _clean_tamil(tv.value))
            rec.field_sources[f] = "tamil"

    if english:
        rec.documents["english"] = {
            "filename": english_filename,
            "paragraphs": english.paragraphs,
        }
        notes.extend(f"[english] {n}" for n in english.notes)
    if tamil:
        rec.documents["tamil"] = {
            "filename": tamil_filename,
            "paragraphs": tamil.paragraphs,
        }
        notes.extend(f"[tamil] {n}" for n in tamil.notes)

    rec.notes = notes
    return rec
