"""
Raw text extraction from a PDF file.

This is the ONLY place that touches the PDF bytes. Everything downstream
(extractor.py) works on the plain text this returns. Kept separate so the
text-getting strategy (pdfplumber today) can be swapped or extended (e.g.
OCR fallback for scanned real-world documents) without touching any
parsing/regex logic.
"""
from __future__ import annotations

import re
from pathlib import Path

import pdfplumber

# Some PDFs in this batch embed a font subset that maps certain glyphs to
# the NUL control character on extraction instead of just omitting them
# (see extractor.py docstring for the underlying font-subset defect). Strip
# those out so downstream text/regex logic and any displayed text don't
# carry literal NUL bytes.
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def read_pdf_text(path: Path) -> str:
    """Return the full text of a PDF, pages joined with a form-feed.

    Uses pdfplumber (layout-aware) which handles the justified/wrapped
    paragraph text in these documents better than a naive extractor.
    Returns '' if the file has no extractable text layer at all (e.g. a
    scanned real-world document) — callers should treat that as
    "needs OCR", not as "field is missing".
    """
    if not path.exists():
        return ""
    try:
        with pdfplumber.open(path) as pdf:
            pages = [page.extract_text() or "" for page in pdf.pages]
        text = "\f".join(pages)
        return _CONTROL_CHARS.sub("", text)
    except Exception:
        return ""
