#!/usr/bin/env python3
"""
parse_areg.py
--------------
Parses an "AREG EXTRACT (RURAL)" PDF (Tamil Nadu A-Register / adangal
register) into a clean CSV table of survey-number / sub-division land
classification records, plus a per-survey-number totals table.

Uses pdfplumber's table detection (the PDF has real table grid lines),
which is far more reliable for this document than plain text splitting,
because several numeric columns sit close enough together that a
whitespace-based split cannot tell them apart.

Usage:
    python3 parse_areg.py <input_areg.pdf> <village_name> <output_dir>

Example:
    python3 parse_areg.py data/raw/achalvadi/areg.pdf achalvadi data/processed/achalvadi

NOTE ON SCOPE: the A-Reg document also prints a trailing "patta / owner"
reference note in the far-right margin of each row (outside the ruled
table grid), which pdfplumber's table detector does not capture. That
ownership information is already available -- more reliably -- from the
Chitta parser (parse_chitta.py), which is the authoritative source for
"who owns what" in this pipeline. A-Reg is used here purely for its
survey/sub-division land-classification detail (soil type, irrigation,
land use, area, tax).
"""

import csv
import re
import sys
from pathlib import Path

import pdfplumber  # type: ignore


def clean_tamil_text(text):
    """Remove artificial whitespace after virama (pulli) that pdfplumber's
    character extraction sometimes inserts inside compound Tamil letters.
    Legitimate word-boundary spaces are preserved.
    """
    if not text or not isinstance(text, str):
        return text
    s = re.sub(r'(\u0BCD)\s+(?=[\u0B80-\u0BFF])', r'\1', text)
    s = re.sub(r'([\u0B80-\u0BFF])\s+\.', r'\1.', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

COLUMNS = [
    "survey_number", "sub_division", "old_survey_subdivision",
    "tenure_flag", "tenure_type", "land_use", "irrigation_source",
    "double_crop", "soil_type_code", "soil_grade",
    "tax_rate_rs", "tax_rate_paise", "area_hectare", "area_are",
    "total_tax_rs", "total_tax_paise",
]

TOTAL_RE = re.compile(r"TOTAL FOR SURVEY NUMBER\s*-?\s*(\S+)")

# pdfplumber's character extraction reorders some Tamil vowel-sign glyphs
# for this PDF's embedded font (a rendering quirk of this particular
# Chrome/Skia-produced PDF -- pdftotext handles it correctly, pdfplumber's
# table extractor does not). The land-use/tenure vocabulary is a small
# closed set, so the safest fix is a direct lookup rather than a general
# (and fragile) Tamil-reordering algorithm. Add an entry here if you spot
# a new scrambled term in a future village's A-Reg file -- compare against
# a rasterized page (pdftoppm) to read the correct form visually.
TEXT_FIXUPS = {
    "ரயதது் வாரி": "ரயத்துவாரி",             # ryotwari (patta land)
    "ரயதது் வாரி\nமைன": "ரயத்துவாரி மனை",     # ryotwari house-site
    "புஞ்ைச": "புஞ்சை",                       # dry (rain-fed) land
    "நஞ்ைச": "நஞ்சை",                         # wet (irrigated) land
    "புறம்ேபாக்கு": "புறம்போக்கு",             # government poromboke land
    "நத்தம்\nபுறம்ேபாக்கு": "நத்தம் புறம்போக்கு",  # habitation poromboke
    "தீரை் வ\nவிதிக்கப்படட் து": "தீர்வை விதிக்கப்பட்டது",  # "tax has been levied"
}


def fix_text(v):
    return TEXT_FIXUPS.get(v, v)


def is_data_row(row):
    return bool(row and row[0] and str(row[0]).strip().isdigit())


def is_total_row(row):
    return bool(row and row[0] and "TOTAL FOR SURVEY NUMBER" in str(row[0]))


def clean(v):
    return (v or "").strip()


def parse_areg(pdf_path: str, village: str):
    data_rows = []
    total_rows = []

    with pdfplumber.open(pdf_path) as pdf:
        for page_no, page in enumerate(pdf.pages, start=1):
            for table in page.extract_tables():
                for row in table:
                    row = [clean(c) for c in row]
                    if is_data_row(row):
                        rec = dict(zip(COLUMNS, row + [""] * (len(COLUMNS) - len(row))))
                        rec["tenure_type"] = clean_tamil_text(fix_text(rec["tenure_type"]))
                        rec["land_use"] = clean_tamil_text(fix_text(rec["land_use"]))
                        rec["irrigation_source"] = clean_tamil_text(rec.get("irrigation_source", ""))
                        rec["village"] = village
                        rec["page"] = page_no
                        data_rows.append(rec)
                    elif is_total_row(row):
                        m = TOTAL_RE.search(row[0])
                        total_rows.append({
                            "village": village,
                            "page": page_no,
                            "survey_number": m.group(1) if m else "",
                            "total_area_hectare": row[12] if len(row) > 12 else "",
                            "total_area_are": row[13] if len(row) > 13 else "",
                            "total_tax_rs": row[14] if len(row) > 14 else "",
                            "total_tax_paise": row[15] if len(row) > 15 else "",
                        })
    return data_rows, total_rows


def write_csv(rows, path: Path):
    if not rows:
        print(f"WARNING: no rows to write for {path}")
        return
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows -> {path}")


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)

    pdf_path, village, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    data_rows, total_rows = parse_areg(pdf_path, village)

    n_surveys = len({r["survey_number"] for r in data_rows})
    print(f"Detected {n_surveys} distinct survey numbers, {len(data_rows)} sub-division rows")

    write_csv(data_rows, out_dir / f"{village}_areg_subdivisions.csv")
    write_csv(total_rows, out_dir / f"{village}_areg_survey_totals.csv")


if __name__ == "__main__":
    main()
