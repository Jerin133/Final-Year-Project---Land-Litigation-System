# Module 1 — Land Record Integration

This is a working pipeline for **Module 1** of your land-litigation
project: it takes Tamil Nadu **Chitta** and **A-Register** PDFs for a
village and turns them into a queryable database, so that given
**District + Taluk + Village + Survey Number** you get back:

- Land ownership details (from Chitta)
- Extent (area under wet/dry/other classification, from Chitta)
- Patta information (patta number, co-owners, from Chitta)
- Land classification (soil type, irrigation, tenure, from A-Register)
- GIS coordinates — **not available from these documents** (see the
  "About GIS coordinates" section below — this is not a bug, it's a
  data-source gap you'll need to close separately).

It has been built and tested against the actual "Achalvadi" Chitta
(237 pages) and A-Reg (76 pages) files you supplied. Every number in
the "Verification" section below was checked against the source PDF
by hand.

---

## 1. Folder structure

```
project/
├── config/
│   └── villages.csv          # master list: district, taluk, village
├── data/
│   ├── raw/
│   │   └── <village>/
│   │       ├── chitta.pdf    # place the village's Chitta PDF here
│   │       └── areg.pdf      # place the village's A-Reg PDF here
│   └── processed/
│       └── <village>/
│           ├── <village>_chitta_owners.csv
│           ├── <village>_chitta_survey.csv
│           ├── <village>_chitta_unparsed.csv   (only if review needed)
│           ├── <village>_areg_subdivisions.csv
│           └── <village>_areg_survey_totals.csv
├── db/
│   ├── schema.sql             # SQLite schema (run once by build_db.py)
│   └── land_records.db        # the actual database (generated)
├── scripts/
│   ├── parse_chitta.py        # Chitta PDF -> CSV
│   ├── parse_areg.py          # A-Reg PDF -> CSV
│   ├── build_db.py            # CSVs -> SQLite
│   └── query_module1.py       # Module 1 CLI: village+survey -> full record
└── docs/
    └── README.md               # this file
```

`data/raw/achalvadi/` already has `chitta.pdf` and `areg.pdf` from what
you uploaded, and `data/processed/achalvadi/` + `db/land_records.db`
already contain the fully processed output, so you can run the
verification queries in section 5 immediately without re-parsing
anything.

---

## 2. One-time setup

You need Python 3.10+ and `poppler-utils` (for `pdftotext`).

```bash
# Ubuntu/Debian
sudo apt-get install poppler-utils

# Python packages
pip install pdfplumber pypdf
```

That's the entire dependency list — no paid services, no cloud APIs.

---

## 3. Running the pipeline for a village

Say you're adding a new village called `siruvachur`. Three steps:

**Step 1 — Drop in the two PDFs**

```bash
mkdir -p data/raw/siruvachur
cp /path/to/SIRUVACHUR_CHITTA.pdf data/raw/siruvachur/chitta.pdf
cp /path/to/SIRUVACHUR_AREG.pdf   data/raw/siruvachur/areg.pdf
```

**Step 2 — Register it in `config/villages.csv`**

```csv
village,taluk,district
achalvadi,Harur,Dharmapuri
siruvachur,<taluk>,<district>
```

**Step 3 — Parse and load**

```bash
python3 scripts/parse_chitta.py data/raw/siruvachur/chitta.pdf siruvachur data/processed/siruvachur
python3 scripts/parse_areg.py   data/raw/siruvachur/areg.pdf   siruvachur data/processed/siruvachur
python3 scripts/build_db.py     # do NOT pass --reset, or you'll wipe out achalvadi's data too
```

`build_db.py` reads every village listed in `config/villages.csv` and
(re)loads all of them each time, so it's safe to re-run — but only
pass `--reset` the first time or when you deliberately want to wipe
and rebuild the whole database from scratch.

Repeat these 3 steps for your third village.

---

## 4. Querying (Module 1's actual input/output)

```bash
# Full record for a survey number
python3 scripts/query_module1.py --village achalvadi --survey 116

# If you have villages with the same name in different taluks, disambiguate:
python3 scripts/query_module1.py --village achalvadi --taluk Harur --district Dharmapuri --survey 116

# Look up by Patta number instead of survey number
python3 scripts/query_module1.py --village achalvadi --patta 9

# Just see how many records a village has loaded
python3 scripts/query_module1.py --village achalvadi
```

This is the script Module 7 (Citizen Dashboard) and Module 8
(Government Dashboard) will eventually call into — right now it's a
CLI, but the query logic in `query_by_survey()` /
`query_by_patta()` inside `scripts/query_module1.py` is what you'd
wrap in a Flask/FastAPI endpoint later for a real dashboard.

---

## 5. Verification (proving the parser is correct)

Don't just trust the pipeline — spot-check it against the source PDF
directly. Here's a worked example using data already loaded.

**Check against the PDF itself:**

```bash
pdftotext -layout -f 1 -l 1 data/raw/achalvadi/chitta.pdf -
```

Page 1 of the Chitta shows, for **Patta No. 4**:
`புல எண் 32 - 1A`, புன்செய் (dry) area `1 - 67.50`, tax `4.20`,
remark `சதுரகிணறு 1`, owner `அசோகன்` (relative: `புருஸோத்தமன்`, relation
`மகன்`).

Now run:

```bash
python3 scripts/query_module1.py --village achalvadi --patta 4
```

You should see exactly that owner and exactly those figures come back.
More generally, for Survey Number 1:

```bash
python3 scripts/query_module1.py --village achalvadi --survey 1
```

should list Patta Nos. 32, 33, 34, 197, 221, 222, 264, 347, 348, 4467
as the owners of the various sub-divisions of Survey No. 1, with a
**total tax of Rs. 5.71** and **total area 4Ha 61.50Ar** for the whole
survey number (this matches the "TOTAL FOR SURVEY NUMBER- 1" line
printed in the A-Reg PDF itself).

**Known limitation — always check this file after parsing a new
village:**

```bash
cat data/processed/<village>/<village>_chitta_unparsed.csv
```

For Achalvadi, 55 lines across 12 patta numbers (mostly government /
institutional land with very long wrapped names, e.g. "Government of
Tamil Nadu represented by the Collector...") didn't fit the row
pattern the parser expects and were **not** silently dropped — they're
listed in this CSV so you can add them to the database by hand if your
survey-number lookups need them. This is normal for government-owned
parcels; ordinary individual-owner pattas parse at ~99%+.

---

## 6. Working with the database directly

The database is plain SQLite at `db/land_records.db`. You don't need
any special software to look at it:

```bash
# Command line
sqlite3 db/land_records.db
sqlite> SELECT * FROM chitta_pattas LIMIT 5;
sqlite> SELECT owner_name, relation FROM chitta_owners WHERE patta_id = 4;
sqlite> .quit
```

Or install **DB Browser for SQLite** (https://sqlitebrowser.org/) —
free, graphical, works on Windows/Mac/Linux — open
`db/land_records.db` in it to browse/edit tables visually. This is the
easiest way to demo the database to your project guide.

**Table map:**

| Table | What it holds | Key columns |
|---|---|---|
| `villages` | one row per district+taluk+village | `village_id` |
| `chitta_pattas` | one row per patta number | `patta_id`, `patta_number` |
| `chitta_owners` | owners under each patta | `patta_id`, `owner_name`, `relation` |
| `chitta_survey` | survey/sub-division extent under each patta | `patta_id`, `survey_number`, `sub_division` |
| `areg_subdivisions` | land classification per survey sub-division | `survey_number`, `sub_division`, `land_use` |
| `areg_survey_totals` | per-survey-number area/tax totals | `survey_number` |
| `gis_coordinates` | placeholder — currently empty | `survey_number`, `geometry_wkt` |

A useful cross-reference query (ownership + land classification
together) — this is exactly what `query_module1.py` does internally:

```sql
SELECT p.patta_number, o.owner_name, s.survey_number, s.sub_division,
       a.land_use, a.soil_type_code, a.area_hectare, a.area_are
FROM chitta_survey s
JOIN chitta_pattas p ON p.patta_id = s.patta_id
JOIN chitta_owners o ON o.patta_id = p.patta_id
LEFT JOIN areg_subdivisions a
       ON a.village_id = p.village_id
      AND a.survey_number = s.survey_number
      AND a.sub_division = s.sub_division
WHERE s.survey_number = '116' AND s.is_total_row = 0;
```

**Upgrading later (Module 6 — GIS):** SQLite has no native spatial
type. Once you're ready to load real survey-boundary geometry (from
FMB sketches or the TN DILRMP portal), the cleanest path is to migrate
to **PostgreSQL + PostGIS** — same table design, but change
`gis_coordinates.geometry_wkt TEXT` to a proper
`geometry(Polygon, 4326)` column so Module 6 can run spatial queries
("show all disputed lands within 500m of survey X") directly in SQL.
The `schema.sql` file has a comment marking this exact spot.

---

## 7. About GIS coordinates (important, read this)

Your Module 1 spec lists "GIS coordinates" as an output. **Neither the
Chitta nor the A-Register PDF contains any geometry at all** — they
are purely textual revenue records (ownership, extent, tax). This
isn't something the parser failed to extract; the source documents
genuinely don't have it.

To get real survey-boundary coordinates you need one of:
- **FMB (Field Measurement Book) sketches** for the village, digitized
  as a shapefile/GeoJSON, or
- The **Tamil Nadu DILRMP** portal's published parcel-boundary layer
  (where available for your district).

The `gis_coordinates` table is already in the schema and wired into
`query_module1.py`'s output (it currently prints "Not available") —
once you obtain boundary data for a village, load it as
`(village_id, survey_number, geometry_wkt, source)` rows and it will
show up automatically in every query.

---

## 8. Why parsing needed two different approaches

You'll notice `parse_chitta.py` uses `pdftotext -layout` + regex,
while `parse_areg.py` uses `pdfplumber`'s table detector. This wasn't
arbitrary:

- **Chitta**: `pdftotext -layout` renders Tamil names correctly
  (proper vowel-sign ordering), and the row shapes are predictable
  enough that anchored regex (looking for the known "relation" words
  மகன்/மனைவி/மகள்/etc. as an anchor, rather than guessing column
  boundaries from whitespace) parses it reliably.
- **A-Reg**: this table has many short, tightly-packed numeric
  columns sitting right next to each other; a plain whitespace split
  merges adjacent columns unpredictably. `pdfplumber` reads the PDF's
  actual (invisible) table grid lines instead, which gives 100%
  reliable column separation — but its Tamil text extraction
  scrambles a handful of specific words (a font-specific quirk of
  this particular PDF). `parse_areg.py` fixes this with a small
  lookup table (`TEXT_FIXUPS`) for the handful of scrambled
  land-use/tenure terms found in this data. **If a new village's
  A-Reg file shows an unfamiliar scrambled Tamil word** in
  `tenure_type`/`land_use` after parsing, rasterize the relevant page
  (`pdftoppm -jpeg -r 150 -f <page> -l <page> areg.pdf page`) and read
  it visually to find the correct spelling, then add an entry to
  `TEXT_FIXUPS` in `parse_areg.py`.

---

## 9. Quick troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `pdftotext: command not found` | `sudo apt-get install poppler-utils` |
| `ModuleNotFoundError: pdfplumber` | `pip install pdfplumber` |
| A village's query returns nothing | Check `config/villages.csv` spelling matches exactly (case-insensitive is OK) and that you ran `build_db.py` **after** adding the village |
| `build_db.py` wiped my other villages | You passed `--reset` — that clears the whole DB. Just re-run parse+build for every village again (all your CSVs are still in `data/processed/`, nothing there was lost) |
| Some patta/survey numbers "missing" | Check `<village>_chitta_unparsed.csv` — see section 5 |
