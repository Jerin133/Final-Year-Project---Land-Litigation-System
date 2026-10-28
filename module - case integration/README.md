# Module 2 — PDF-native Court Case Retrieval (Kudumiyampatti)

Retrieves land-litigation case information **directly from the court-case
PDFs** — English and Tamil — by survey number and other criteria. There is
**no spreadsheet/CSV/Excel data store** anywhere in the running app: every
field the API returns is parsed out of the PDF text when the app starts, and
the full narrative paragraph text of both the English and Tamil documents is
served back to you as well, not just the top headings.

> **⚠️ ALL CASE DATA IN `data/pdf/` IS SYNTHETIC.** It was generated for
> developing and testing this retrieval module, before real case documents
> are available. It is **not** an official court record, judgment, CNR
> document, or evidence of any actual dispute. Every API response repeats
> this (`"data_provenance": "SYNTHETIC"`), and `/health` spells it out in
> full. See "Switching to real data" below for what happens when the
> synthetic PDFs are replaced.

## Why this design

Your ask was specifically: *read from the raw PDFs at query time — not a
maintained spreadsheet — get the full paragraph content (not just headings),
in both English and Tamil, for a given survey number, and keep working once
synthetic PDFs are swapped for real ones.* Three things follow from that:

1. **No hand-maintained index.** `app/index_builder.py` scans
   `data/pdf/english/` and `data/pdf/tamil/` and rebuilds the entire case
   index from PDF text every time the app starts — nothing is pre-computed
   into a CSV that could drift from the PDFs. Only the *result of parsing
   the PDFs* is held in memory.
2. **Two extraction layers, not one.** `app/extractor.py` runs a
   narrative-paragraph parser tuned to this batch's "case report / order"
   template, *and* a generic bilingual label:value line scanner (for
   older-style tabular documents). Narrative wins when both find a value;
   the label:value layer only fills gaps. This is what makes the system
   keep working if real documents arrive in a different layout — see
   "Switching to real data" below, where I tested this against last
   session's older-format PDFs.
3. **Bilingual by construction.** Every case record carries both an English
   and a Tamil representation — status, dispute type, party names, and the
   full paragraph text of whichever PDFs exist for that case — not a
   single-language record with a translation bolted on.

## A real bug I found and designed around

While building this, I found that **the Tamil PDFs' text layer has a
font-subsetting defect**: when you extract text from them (any tool —
`pdftotext`, `pdfplumber`, etc.), the embedded Tamil font:

- **Drops every Latin letter inside a mixed alphanumeric code.** Digits
  survive, letters don't. `Sub-Division 1J4` extracts as `14` (the `J` is
  gone and `1` and `4` silently run together — genuinely dangerous, since a
  real subdivision `14` would look identical). The synthetic reference code
  `SYN-TN-DHA-KUD-0002` extracts as `----0002`.
- **Drops a handful of specific Tamil dispute-type words entirely**
  (boundary dispute, partition, government land, patta issue), leaving a
  blank gap in an otherwise perfectly-extracted sentence, while other Tamil
  words in the very same sentence (and other dispute types like
  "Inheritance"/"Ownership"/"Encroachment") extract fine.

This is a defect in how the PDFs were generated (an incomplete embedded font
subset), not a translation or OCR problem — the text is almost certainly
legible if you open the PDF and look at it; only the extracted text layer is
broken for those specific glyphs.

**How the system works around it:** any field that could contain a Latin
letter (case ID, survey number, subdivision, the synthetic reference code)
is always taken from the **English** document when one is available, and the
Tamil document's own copy is used only as a cross-check, never silently
trusted on its own. Tamil status and dispute-type *labels* shown to you come
from a verified English→Tamil translation table, not from re-parsing the
(sometimes-blank) Tamil words — so you always get the correct Tamil label
even for the categories the font bug erases. The **literal** Tamil paragraph
text is still served as-is in `documents.tamil.paragraphs`, gaps and all, so
nothing is hidden from you. If a case only has a Tamil PDF (no English
counterpart — e.g. some future real-data case), those Latin-sensitive fields
are still read from the Tamil text as a best-effort fallback, just flagged
with lower confidence (`extraction.confidence` in the response).

If you regenerate the Tamil PDFs, ask the PDF generator to embed the full
Tamil Unicode range (or at minimum the specific glyphs used by the "boundary
dispute / partition / government land / patta issue" phrases and by digits
adjacent to Latin letters) rather than a trimmed subset, and this whole
workaround becomes unnecessary.

## Verified accuracy

`dev_validation/validate.py` compares what the extractor reads out of all
160 PDF pairs against `dev_validation/answer_key_DEV_ONLY.csv` — the record
that was used to *generate* this synthetic batch in the first place. **This
file is dev-only and the running app never reads it**; it exists purely to
prove the extractor's accuracy.

```
FIELD                   CORRECT / TOTAL  ACCURACY
survey_no                   160 / 160     100.0%
subdivision                 160 / 160     100.0%
filing_date                 160 / 160     100.0%
status                      160 / 160     100.0%
dispute_type                160 / 160     100.0%
hearing_count                160 / 160     100.0%
adjournment_count           160 / 160     100.0%
appeal_indicator            160 / 160     100.0%
disposal_date                160 / 160     100.0%
court                        160 / 160     100.0%
petitioner                   160 / 160     100.0%
respondent                   160 / 160     100.0%
-------------------------------------------------------
OVERALL                    1920 / 1920    100.0%
```

Run it yourself: `python3 dev_validation/validate.py`

I also cross-tested the label:value fallback layer against last session's
*older*-format synthetic PDFs (plain "Case No.: / Survey No.: / Court:"
lines, a completely different layout) and it recovered 9 of the fields from
those documents too, without any code path specific to either format.

## Run

```
python -m venv .venv
.venv\Scripts\activate        # or: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Open **http://127.0.0.1:8000/** — that's the search UI (`frontend/index.html`,
served directly by the app). Search by survey number, switch the
English/தமிழ் toggle, and expand "Extraction detail" on any case to see
which document each field came from and its confidence.

If you want the raw interactive API reference instead, that's at
http://127.0.0.1:8000/docs.

**No AI model is called anywhere in this app**, at startup or per search.
Every field is produced by the deterministic pattern-matching in
`app/extractor.py` — see "Verified accuracy" below.

## API

- `GET /health` — index size, and the synthetic-data disclosure.
- `GET /survey/{survey_no}?subdivision=...` — **primary lookup.** All cases
  on record for a survey number, full bilingual detail including complete
  paragraph text from both PDFs.
- `GET /cases/search?survey_no=&subdivision=&village=&party=&court=&status=&dispute_type=`
  — filtered summary list.
- `GET /cases/{case_id}` — one case, full bilingual detail.
- `GET /cases/{case_id}/pdf?language=english|tamil` — the original PDF.

Example:
```
GET /survey/71
```
```json
{
  "survey_no": "71",
  "count": 4,
  "official_records": false,
  "data_provenance": "SYNTHETIC",
  "cases": [
    {
      "case_id": "SYN-KUD-0001",
      "survey_no": "71",
      "subdivision": "1J4",
      "status": {"english": "Pending", "tamil": "நிலுவையில்"},
      "dispute_type": {"english": "Inheritance", "tamil": "வாரிசுரிமை"},
      "petitioner": "ஏகநாதன்",
      "respondent": "இளவரசன்",
      "documents": {
        "english": {"filename": "SYN-KUD-0001_71_1J4.pdf",
                     "paragraphs": {"1": "...", "2": "...", "...": "all 7"}},
        "tamil":   {"filename": "SYN-KUD-0001_71_1J4.pdf",
                     "paragraphs": {"1": "...", "...": "all 7, literal extraction"}}
      },
      "extraction": {"field_sources": {...}, "confidence": {...}, "notes": [...]},
      "data_provenance": "SYNTHETIC - not an official court record, judgment or CNR document."
    }
  ]
}
```

## Switching to real data

1. Replace the files under `data/pdf/english/` and `data/pdf/tamil/` with
   real case PDFs (English and Tamil copies of the same case should share
   the same filename across the two folders, the way this batch does — not
   required, but it's how the two languages get paired into one record).
2. Restart the app (or extend `app/main.py`'s `_reload()` to a `/reload`
   endpoint if you want to pick up new PDFs without a restart).
3. Nothing else changes. The extractor is pattern-based (numbered-paragraph
   prose **and** label:value lines, both bilingual), not hard-coded to this
   batch's case numbers or wording. If real documents use different label
   wording than the two styles here, add the new label synonyms to the
   `_LABELS` dict in `app/extractor.py` and/or new narrative-phrase patterns
   to `_extract_narrative_english` / `_extract_narrative_tamil` — the rest
   of the pipeline (index building, merging, API) needs no changes.
4. `official_record` in every response is currently hard-coded to `false`.
   Once real records are in place, decide how you want to flag that (e.g. a
   per-PDF marker, or a folder split) and update `_summary()`/`_full()` in
   `app/main.py` accordingly — I left it explicit rather than guessing.

## Project layout

```
app/
  pdf_reader.py        raw PDF -> text (pdfplumber), strips a font-bug
                        artefact (literal NUL bytes) from the Tamil PDFs
  extractor.py          text -> structured fields (narrative + labelled
                        layers, bilingual, paragraph splitting)
  case_record.py         merges one case's English + Tamil extraction into
                        a single bilingual record (Tamil-font-bug workaround
                        lives here)
  index_builder.py       scans data/pdf/{english,tamil}, builds the
                        in-memory index — the only "index build" step,
                        and it's PDFs-in, no CSV involved
  main.py                FastAPI app / endpoints, serves frontend/index.html at "/"
frontend/
  index.html              the search UI — single self-contained HTML file,
                        no build step, no external dependencies
data/pdf/english/        160 synthetic English case PDFs
data/pdf/tamil/          160 synthetic Tamil case PDFs
dev_validation/           accuracy check against the generation answer key —
                        NOT used by the running app
```
