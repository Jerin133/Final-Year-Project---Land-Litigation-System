"""
Turns the raw text of ONE court-case PDF into structured fields.

Design notes (please read before changing regexes)
----------------------------------------------------
1. Two independent layers run over every document, in order:

     LAYER A - NARRATIVE.
         Tuned to the numbered-paragraph "case report / order" template
         used by the current Kudumiyampatti Module-2 PDFs (paragraphs
         1-7: preamble, parties+survey link, dispute classification,
         reference/filing/status/counts, court consideration, appeal/
         disposal, disclaimer). Patterns are written as tolerant
         alternatives (optional words, flexible whitespace/line-wraps)
         rather than exact strings, so minor wording drift in future
         batches still matches.

     LAYER B - LABELLED FIELDS.
         A generic "Label: value" / "Label - value" line scanner,
         bilingual (English + Tamil labels). This is what will still
         work if real land-litigation documents arrive in the older
         tabular/label style instead of prose, or in a style that
         mixes both. It costs nothing extra to run.

   Layer A results win when both layers find a value for the same
   field; Layer B only fills gaps Layer A left empty. Every field
   carries provenance ("narrative" / "labelled" / None) and a
   confidence, so a caller can see exactly how a value was obtained -
   important once this runs on real records instead of synthetic ones.

2. KNOWN TAMIL-PDF TEXT-LAYER DEFECT (discovered while building this):
   the Tamil PDFs in this batch were produced with an embedded font
   subset that silently drops some glyphs when text is copied out:
     - Any Latin LETTER mixed into an alphanumeric code is dropped
       (digits survive). "Sub-Division 1J4" becomes "1 4" / "14" in
       the extracted Tamil text; the synthetic reference code
       "SYN-TN-DHA-KUD-0002" becomes "----0002".
     - A handful of specific Tamil dispute-type words (boundary
       dispute, partition, government land, patta issue) vanish
       completely from the extracted text of the Tamil PDF, leaving a
       blank gap, even though the rest of the sentence extracts fine.
   Both are text-EXTRACTION defects, not translation errors — the
   words are almost certainly present and readable in the PDF when
   viewed, the embedded font just fails to map back to text for a
   subset of glyphs. Because of this, survey/subdivision codes,
   the case reference/id, and the dispute-type label are always taken
   from the English document when one is available; the Tamil
   document is still parsed and cross-checked, but does not override
   those fields on its own. Fields built only from digits or from
   whole common Tamil words (dates, counts, status, court, village/
   taluk/district, appeal Yes/No) are read directly from the Tamil
   text and are reliable.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


# --------------------------------------------------------------------
# Canonical value vocab + English<->Tamil label translation.
# Used to (a) normalise whatever narrative/labelled text extraction
# turns up into one of these canonical values, and (b) supply a
# trustworthy Tamil label even when the Tamil PDF's own copy of that
# word is one of the ones the font-subset bug drops.
# --------------------------------------------------------------------
DISPUTE_TYPES_EN_TA = {
    "Boundary dispute": "எல்லை தகராறு",
    "Encroachment": "ஆக்கிரமிப்பு",
    "Ownership": "உரிமை",
    "Partition": "பாகப்பிரிவினை",
    "Inheritance": "வாரிசுரிமை",
    "Government land": "அரசு நிலம்",
    "Patta issue": "பட்டா பிரச்சனை",
    "Access pathway": "பாதை தகராறு",
    "Pathway": "பாதை தகராறு",
    "Easement": "வழி உரிமை",
    "Title dispute": "உரிமை தகராறு",
    "Land acquisition": "நில எடுப்பு",
}
DISPUTE_TYPES_TA_EN = {v: k for k, v in DISPUTE_TYPES_EN_TA.items()}
# Looser Tamil matches actually observed in extracted text (superstrings
# etc.) mapped to the same canonical keys, for best-effort Tamil-side reads.
DISPUTE_TYPES_TA_ALIASES = {
    "எல்லை": "Boundary dispute",
    "எல்லை தகராறு": "Boundary dispute",
    "எல்லைத் தகராறு": "Boundary dispute",
    "சொத்துரிமை": "Ownership",
    "உரிமை": "Ownership",
    "ஆக்கிரமிப்பு": "Encroachment",
    "பாகப்பிரிவினை": "Partition",
    "பாகப்பிரிவினைத் தகராறு": "Partition",
    "பாகப்பிரிவினை தகராறு": "Partition",
    "வாரிசுரிமை": "Inheritance",
    "அரசு நிலம்": "Government land",
    "பட்டா பிரச்சனை": "Patta issue",
    "பாதை தகராறு": "Access pathway",
    "வழிப்பாதை": "Access pathway",
}

STATUS_EN_TA = {
    "Pending": "நிலுவையில்",
    "Disposed": "முடிக்கப்பட்டது",
    "Appeal Pending": "மேல்முறையீடு நிலுவையில்",
}
STATUS_TA_EN = {v: k for k, v in STATUS_EN_TA.items()}
STATUS_TA_ALIASES = {
    "முடிவுற்றது": "Disposed",
    "தீர்க்கப்பட்டது": "Disposed",
    "தள்ளுபடி": "Disposed",
    "நிலுவை": "Pending",
}

CASE_TYPES = ["I.A.", "O.S.", "W.P.", "Civil Miscellaneous", "Revenue Appeal"]


def _clean(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    s = re.sub(r"\s+", " ", s).strip(" .,\u200b")
    return s or None


def _clean_tamil_text(text: Optional[str]) -> Optional[str]:
    """Remove artificial whitespace that PDF text extraction inserts after virama
    (pulli, \u0BCD) inside compound Tamil letters. Only removes spaces right after
    a virama when followed by another Tamil character; genuine word boundaries
    (spaces between separate words) are preserved."""
    if not text or not isinstance(text, str):
        return text
    # Space after virama before any Tamil character is always artificial
    s = re.sub(r'(\u0BCD)\s+(?=[\u0B80-\u0BFF])', r'\1', text)
    # Space before dot in initials (e.g. "என் .குணசேகரன்" -> "என்.குணசேகரன்")
    s = re.sub(r'([\u0B80-\u0BFF])\s+\.', r'\1.', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s or None


def _collapse_singleword_gaps(name: Optional[str]) -> Optional[str]:
    """Tamil names in justified/wrapped paragraph text sometimes pick up a
    single spurious internal space from line-fill justification (e.g. a
    name rendered as "செல் லன்"). We cannot always tell a real two-word
    name from an artefact, so this is only used as a last resort when no
    clean version of the name is available from elsewhere (e.g. the
    English document's centered, non-justified party line)."""
    if not name:
        return name
    return name


@dataclass
class FieldResult:
    value: Optional[object] = None
    source: Optional[str] = None       # "narrative" | "labelled" | None
    confidence: float = 0.0


@dataclass
class ExtractionResult:
    language: str  # "english" | "tamil"
    fields: dict = field(default_factory=dict)   # name -> FieldResult
    paragraphs: dict = field(default_factory=dict)  # "1".."7" -> text
    full_text: str = ""
    notes: list = field(default_factory=list)

    def value(self, name, default=None):
        fr = self.fields.get(name)
        return fr.value if fr and fr.value is not None else default


# --------------------------------------------------------------------
# Paragraph splitting (language-agnostic: paragraphs start with "<n>. "
# or standard section headings for unnumbered narratives)
# --------------------------------------------------------------------
_PARA_START = re.compile(r"(?m)^\s*([1-9])\.\s")

SECTION_HEADERS = [
    # English
    "Introduction",
    "Facts alleged in the petition",
    "Response of the respondent",
    "Issues for consideration",
    "Material and evidence referred to",
    "Discussion",
    "Findings",
    "Order / procedural status",
    "Data provenance and AI use",
    "Hearing history",
    # Tamil
    "அறிமுகம்",
    "மனுவில் கூறப்பட்டுள்ள உண்மைகள்",
    "எதிர்மனுதாரரின் பதில்",
    "பரிசீலிக்க வேண்டிய கேள்விகள்",
    "குறிப்பிடப்பட்ட ஆவணங்கள் மற்றும் ஆதாரங்கள்",
    "ஆய்வு",
    "கண்டறிதல்கள்",
    "உத்தரவு / நடைமுறை நிலை",
    "தரவு மூலமும் AI பயன்பாடும்",
    "விசாரணை வரலாறு",
]
_SEC_START = re.compile(r"(?m)^(" + "|".join(re.escape(h) for h in SECTION_HEADERS) + r")\s*$")


def split_numbered_paragraphs(text: str) -> dict:
    """Return {"1": "...", "2": "...", ...} for the numbered narrative
    paragraphs or section-based narrative paragraphs found in the text."""
    matches = list(_PARA_START.finditer(text))
    if not matches:
        matches = list(_SEC_START.finditer(text))
    out = {}
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        num = str(i + 1)
        body = text[start:end]
        # stop at a form-feed (page break) or the signature block
        body = body.split("\f")[0]
        out[num] = _clean_tamil_text(_clean(body))
    return out


# --------------------------------------------------------------------
# LAYER A: narrative-template extraction (English)
# --------------------------------------------------------------------
def _extract_narrative_english(text: str) -> dict:
    out = {}

    m = re.search(r"BEFORE THE HON'?[’]?BLE\s+(.+)", text)
    if m:
        raw = _clean(m.group(1))
        court = _smart_title_case(raw) if raw else None
        out["court"] = FieldResult(court, "narrative", 0.9)

    m = re.search(
        r"SYNTHETIC\s+(" + "|".join(re.escape(c) for c in CASE_TYPES) + r")\s+No\.?\s*(\d+)\s*/\s*(\d{4})",
        text,
    )
    if m:
        out["case_type"] = FieldResult(m.group(1), "narrative", 0.95)
        out["case_number"] = FieldResult(f"{m.group(2)}/{m.group(3)}", "narrative", 0.95)

    m = re.search(r"\n\s*(.+?)\s*\.\.\.\s*Petitioner", text)
    if m:
        out["petitioner"] = FieldResult(_clean_tamil_text(_clean(m.group(1))), "narrative", 0.85)
    m = re.search(r"\n\s*(.+?)\s*\.\.\.\s*Respondent", text)
    if m:
        out["respondent"] = FieldResult(_clean_tamil_text(_clean(m.group(1))), "narrative", 0.85)

    m = re.search(
        r"land situated at\s+(.+?)\s+Village,\s+(.+?)\s+Taluk,\s+(.+?)\s+District",
        text, re.S,
    )
    if m:
        out["village"] = FieldResult(_clean(m.group(1)), "narrative", 0.9)
        out["taluk"] = FieldResult(_clean(m.group(2)), "narrative", 0.9)
        out["district"] = FieldResult(_clean(m.group(3)), "narrative", 0.9)

    m = re.search(r"Survey No\.?\s*(\d+),?\s*Sub-?Division\s*([A-Za-z0-9]+)", text, re.S)
    if m:
        out["survey_no"] = FieldResult(m.group(1), "narrative", 0.95)
        out["subdivision"] = FieldResult(m.group(2), "narrative", 0.95)

    m = re.search(r"classified for this dataset as\s+(.+?)\.", text, re.S)
    if m:
        raw = _clean(m.group(1))
        out["dispute_type"] = FieldResult(raw, "narrative", 0.9)

    m = re.search(r"synthetic reference\s+(\S+)", text)
    if m:
        out["synthetic_reference"] = FieldResult(m.group(1).strip("."), "narrative", 0.9)

    m = re.search(r"filing date\s*\n?\s*of\s+(\d{2}\.\d{2}\.\d{4})", text, re.S)
    if m:
        out["filing_date"] = FieldResult(m.group(1), "narrative", 0.9)

    m = re.search(r"present status in the dataset is\s+(.+?)\.", text, re.S)
    if m:
        out["status"] = FieldResult(_clean(m.group(1)), "narrative", 0.9)

    m = re.search(r"reflects\s+(\d+)\s+hearing", text, re.S)
    if m:
        out["hearing_count"] = FieldResult(int(m.group(1)), "narrative", 0.9)

    m = re.search(r"(\d+)\s+adjournment", text)
    if m:
        out["adjournment_count"] = FieldResult(int(m.group(1)), "narrative", 0.9)

    m = re.search(r"appeal indicator as\s+(Yes|No)", text, re.I)
    if m:
        out["appeal_indicator"] = FieldResult(m.group(1).strip().lower() == "yes", "narrative", 0.9)

    m = re.search(r"disposed on\s+(\d{2}\.\d{2}\.\d{4})", text)
    if m:
        out["disposal_date"] = FieldResult(m.group(1), "narrative", 0.9)

    m = re.search(r"SYNTHETIC CASE\s*[—\-]+\s*(\S+)\s*[—\-]+", text)
    if m:
        out["case_id"] = FieldResult(m.group(1), "narrative", 0.95)

    return out


def _smart_title_case(s: str) -> str:
    small = {"of", "the", "and", "for"}
    words = s.split()
    res = []
    for i, w in enumerate(words):
        core = w.strip(",")
        comma = "," if w.endswith(",") else ""
        lw = core.lower()
        res.append((lw if (lw in small and i != 0) else core.capitalize()) + comma)
    return " ".join(res)


# --------------------------------------------------------------------
# LAYER A: narrative-template extraction (Tamil) - best effort.
# Only fields built from whole common words / pure digits are trusted;
# anything that can contain a Latin letter is intentionally NOT read
# from Tamil (see module docstring) and is left for the caller to fill
# from the English document instead.
# --------------------------------------------------------------------
def _extract_narrative_tamil(text: str) -> dict:
    out = {}

    m = re.search(r"சர்வே\s*எண்\s*(\d+)", text)
    if m:
        # digits-only value: safe even under the font-subset bug
        out["survey_no"] = FieldResult(m.group(1), "narrative", 0.85)

    m = re.search(r"தாக்கல்\s*தேதி\s*(\d{2}\.\d{2}\.\d{4})", text)
    if m:
        out["filing_date"] = FieldResult(m.group(1), "narrative", 0.85)

    m = re.search(r"தற்போதைய\s*நிலை\s*(.+?)\s*என(?:்றும்|)", text, re.S)
    if m:
        raw = _clean(m.group(1))
        canon = STATUS_TA_EN.get(raw) or STATUS_TA_ALIASES.get(raw)
        out["status"] = FieldResult(canon or raw, "narrative", 0.8 if canon else 0.4)

    m = re.search(r"(\d+)\s*விசாரணை\s*பதிவு", text)
    if m:
        out["hearing_count"] = FieldResult(int(m.group(1)), "narrative", 0.85)

    m = re.search(r"(\d+)\s*ஒத்திவைப்பு\s*பதிவு", text)
    if m:
        out["adjournment_count"] = FieldResult(int(m.group(1)), "narrative", 0.85)

    m = re.search(r"மேல்முறையீட்டு\s*குறியீடு\s*(ஆம்|இல்லை)", text)
    if m:
        out["appeal_indicator"] = FieldResult(m.group(1) == "ஆம்", "narrative", 0.85)

    m = re.search(r"முடிவு\s*தேதி\s*(\d{2}\.\d{2}\.\d{4})", text)
    if m:
        out["disposal_date"] = FieldResult(m.group(1), "narrative", 0.8)

    m = re.search(r"தகராறு\s+(\S+(?:\s+\S+)?)\s+என\s+வகைப்படுத்தப்பட்டுள்ளது", text, re.S)
    if m:
        raw = _clean(m.group(1))
        canon = DISPUTE_TYPES_TA_EN.get(raw) or DISPUTE_TYPES_TA_ALIASES.get(raw)
        if canon:
            out["dispute_type"] = FieldResult(canon, "narrative", 0.75)
        elif raw:
            out["dispute_type"] = FieldResult(raw, "narrative", 0.3)
        # if the gap is empty (font-subset bug), leave unset - caller
        # falls back to the English document.

    # village / taluk / district appear in Tamil prose too, but as plain
    # Tamil words they're not affected by the letter-dropping bug
    m = re.search(r"([^\s,]+)\s*கிராமத்தில்", text)
    if m:
        out["village"] = FieldResult(m.group(1), "narrative", 0.6)

    return out


# --------------------------------------------------------------------
# LAYER B: generic bilingual "label: value" line scanner - fallback for
# real documents that use a tabular/labelled style instead of prose.
# --------------------------------------------------------------------
_LABELS = {
    "case_id": [r"case\s*(?:id|no\.?|number)", r"c\.?\s*no\.?", r"வழக்கு\s*(?:எண்|குறியீடு)"],
    "village": [r"village(?:\s*name)?", r"கிராமம்"],
    "survey_no": [r"survey\s*(?:no\.?|number)", r"subject\s*survey\s*no\.?", r"புல\s*எண்", r"சர்வே\s*எண்"],
    "subdivision": [r"sub[- ]?division", r"உட்பிரிவு"],
    "taluk": [r"taluk", r"வட்டம்", r"தாலுகா"],
    "district": [r"district", r"மாவட்டம்"],
    "petitioner": [r"petitioner(?:\s*/\s*applicant)?", r"applicant", r"மனுதாரர்"],
    "respondent": [r"respondent", r"எதிர்மனுதாரர்"],
    "court": [
        r"court(?:\s*/\s*authority)?(?:\s*name)?",
        r"authority",
        r"court",
        r"நீதிமன்றம்(?:\s*/\s*அதிகார\s*அமைப்பு)?",
        r"அதிகார\s*அமைப்பு",
        r"நீதிமன்றம்",
    ],
    "case_type": [r"case\s*type", r"வழக்கு\s*வகை"],
    "status": [r"case\s*status", r"present\s*status", r"status", r"நிலை", r"தற்போதைய\s*நிலை"],
    "filing_date": [r"filing\s*date", r"தாக்கல்\s*தேதி"],
    "disposal_date": [r"disposal\s*date", r"முடிவு\s*தேதி", r"தீர்ப்பு\s*தேதி"],
    "dispute_type": [r"dispute\s*type", r"dispute\s*category", r"தகராறு\s*வகை", r"தகராறு"],
    "patta_no": [r"patta\s*(?:no\.?|number)", r"பட்டா\s*எண்"],
}


def _extract_labelled(text: str) -> dict:
    out = {}
    for line in text.split("\n"):
        line_clean = line.strip()
        if not line_clean:
            continue

        # 1. Combined Survey No. / Subdivision:
        # e.g., "Survey No. / Subdivision: 108 / 1A1", "புல எண் / உட்பிரிவு: 108 / 1A1"
        m_surv = re.search(
            r"^(?:survey\s*(?:no\.?|number)?\s*/\s*sub[- ]?division|புல\s*எண்\s*/\s*உட்பிரிவு|சர்வே\s*(?:எண்)?\s*/\s*உட்பிரிவு)\.?\s*[:\-]\s*(.+)",
            line_clean,
            re.I,
        )
        if m_surv and "survey_no" not in out:
            combined_val = _clean(m_surv.group(1))
            if combined_val:
                parts = [p.strip() for p in re.split(r"\s*[/,]\s*", combined_val, maxsplit=1)]
                if len(parts) == 2 and parts[0] and parts[1]:
                    out["survey_no"] = FieldResult(parts[0], "labelled", 0.9)
                    out["subdivision"] = FieldResult(parts[1], "labelled", 0.9)
                else:
                    out["survey_no"] = FieldResult(combined_val, "labelled", 0.85)
            continue

        # 2. Combined Taluk / District:
        # e.g., "Taluk / District: Harur / Dharmapuri", "தாலுகா / மாவட்டம்: Harur / Dharmapuri"
        m_td = re.search(
            r"^(?:taluk\s*/\s*district|தாலுகா\s*/\s*மாவட்டம்|வட்டம்\s*/\s*மாவட்டம்)\.?\s*[:\-]\s*(.+)",
            line_clean,
            re.I,
        )
        if m_td and ("taluk" not in out or "district" not in out):
            val_td = _clean(m_td.group(1))
            if val_td:
                parts = [p.strip() for p in re.split(r"\s*[/,]\s*", val_td, maxsplit=1)]
                if len(parts) == 2 and parts[0] and parts[1]:
                    out["taluk"] = FieldResult(parts[0], "labelled", 0.9)
                    out["district"] = FieldResult(parts[1], "labelled", 0.9)
                else:
                    out["taluk"] = FieldResult(val_td, "labelled", 0.85)
            continue

        # 3. Standard single field line matching
        for field_name, alts in _LABELS.items():
            if field_name in out:
                continue
            for alt in alts:
                m = re.search(rf"^(?:{alt})\.?\s*[:\-]\s*(.+)", line_clean, re.I)
                if not m:
                    m = re.search(rf"(?:{alt})\.?\s*[:\-]\s*(.+)", line_clean, re.I)
                if m:
                    val = _clean(m.group(1))
                    if val:
                        out[field_name] = FieldResult(val, "labelled", 0.7)
                    break

    # If survey_no or subdivision contains a slash or was bundled
    if "survey_no" in out and out["survey_no"].value and "/" in str(out["survey_no"].value):
        parts = [p.strip() for p in str(out["survey_no"].value).split("/", 1)]
        if len(parts) == 2 and parts[0] and parts[1]:
            out["survey_no"] = FieldResult(parts[0], out["survey_no"].source, out["survey_no"].confidence)
            if "subdivision" not in out:
                out["subdivision"] = FieldResult(parts[1], out["survey_no"].source, out["survey_no"].confidence)

    if "subdivision" in out and out["subdivision"].value and "/" in str(out["subdivision"].value) and "survey_no" not in out:
        parts = [p.strip() for p in str(out["subdivision"].value).split("/", 1)]
        if len(parts) == 2 and parts[0] and parts[1]:
            out["survey_no"] = FieldResult(parts[0], out["subdivision"].source, out["subdivision"].confidence)
            out["subdivision"] = FieldResult(parts[1], out["subdivision"].source, out["subdivision"].confidence)

    return out


# --------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------
def extract_document(text: str, language: str) -> ExtractionResult:
    language = language.lower()
    result = ExtractionResult(language=language, full_text=text)
    if not text:
        result.notes.append("No extractable text layer (scanned document? needs OCR).")
        return result

    result.paragraphs = split_numbered_paragraphs(text)

    narrative = _extract_narrative_english(text) if language == "english" else _extract_narrative_tamil(text)
    labelled = _extract_labelled(text)

    merged = dict(labelled)
    merged.update(narrative)  # narrative wins on overlap

    # A labelled "Survey No." or "Subdivision" value sometimes bundles both
    # in combined form ("58/1F" or "108 / 1A1").
    sv = merged.get("survey_no")
    subv = merged.get("subdivision")

    if sv and sv.value and "/" in str(sv.value):
        parts = [p.strip() for p in str(sv.value).split("/", 1)]
        if len(parts) == 2 and parts[0] and parts[1]:
            merged["survey_no"] = FieldResult(parts[0], sv.source, sv.confidence)
            if "subdivision" not in merged or not merged["subdivision"].value:
                merged["subdivision"] = FieldResult(parts[1], sv.source, sv.confidence)

    if subv and subv.value and "/" in str(subv.value) and ("survey_no" not in merged or not merged["survey_no"].value):
        parts = [p.strip() for p in str(subv.value).split("/", 1)]
        if len(parts) == 2 and parts[0] and parts[1]:
            merged["survey_no"] = FieldResult(parts[0], subv.source, subv.confidence)
            merged["subdivision"] = FieldResult(parts[1], subv.source, subv.confidence)

    # Inferred hearing counts and adjournments from hearing history if not extracted from narrative
    if "hearing_count" not in merged:
        hearing_nums = [int(m) for m in re.findall(r"(?:Hearing|விசாரணை)\s+(\d+)", text, re.I)]
        if hearing_nums:
            merged["hearing_count"] = FieldResult(max(hearing_nums), "hearing_history", 0.85)

    if "adjournment_count" not in merged:
        adjournment_matches = len(re.findall(r"(?:adjourn|ஒத்திவைப்பு)", text, re.I))
        if adjournment_matches:
            merged["adjournment_count"] = FieldResult(adjournment_matches, "hearing_history", 0.75)

    if "appeal_indicator" not in merged:
        status_val = str(merged.get("status", FieldResult()).value or "")
        if "appeal" in status_val.lower() or "மேல்முறையீடு" in status_val:
            merged["appeal_indicator"] = FieldResult(True, "inferred", 0.85)

    result.fields = merged

    if language == "tamil":
        result.notes.append(
            "Tamil PDF text layer has a known font-subset defect: Latin letters "
            "inside alphanumeric codes (subdivision, reference/case codes) are "
            "dropped, and a few specific Tamil dispute-type words are dropped "
            "entirely. Those fields are sourced from the English document when "
            "available rather than from this Tamil extraction."
        )
    return result
