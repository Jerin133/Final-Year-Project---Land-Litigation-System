-- Module 1: Land Record Integration -- database schema
-- Target engine: SQLite (see docs/README.md for a PostgreSQL/PostGIS
-- upgrade path once Module 6 - GIS Visualization - is built).

PRAGMA foreign_keys = ON;

-- One row per (district, taluk, village)
CREATE TABLE IF NOT EXISTS villages (
    village_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    district     TEXT NOT NULL,
    taluk        TEXT NOT NULL,
    village      TEXT NOT NULL,
    UNIQUE(district, taluk, village)
);

-- One row per Patta number, per village (from Chitta)
CREATE TABLE IF NOT EXISTS chitta_pattas (
    patta_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    village_id   INTEGER NOT NULL REFERENCES villages(village_id),
    patta_number TEXT NOT NULL,
    UNIQUE(village_id, patta_number)
);

-- One row per owner listed under a Patta (a Patta can have several
-- joint owners / legal heirs)
CREATE TABLE IF NOT EXISTS chitta_owners (
    owner_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    patta_id      INTEGER NOT NULL REFERENCES chitta_pattas(patta_id),
    seq_no        TEXT,
    sub_index     TEXT,
    relative_name TEXT,   -- father's/husband's name etc. (may be blank for institutions)
    relation      TEXT,   -- மகன் / மனைவி / மகள் / ... etc.
    owner_name    TEXT
);

-- One row per survey-number/sub-division extent entry under a Patta
-- (from Chitta). is_total_row=1 marks the per-patta subtotal line.
CREATE TABLE IF NOT EXISTS chitta_survey (
    record_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    patta_id              INTEGER NOT NULL REFERENCES chitta_pattas(patta_id),
    seq_no                TEXT,
    survey_subdivision_raw TEXT,
    survey_number         TEXT,
    sub_division           TEXT,
    is_total_row           INTEGER NOT NULL DEFAULT 0,
    nanjai_area            TEXT,  -- wet land, "<acres> - <cents>"
    nanjai_tax             TEXT,
    punjai_area            TEXT,  -- dry land, "<acres> - <cents>"
    punjai_tax             TEXT,
    other_area             TEXT,
    other_tax              TEXT,
    remarks                TEXT
);

-- One row per survey-number/sub-division land-classification entry
-- (from A-Register): soil type, irrigation, land use, area, tax
CREATE TABLE IF NOT EXISTS areg_subdivisions (
    record_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    village_id           INTEGER NOT NULL REFERENCES villages(village_id),
    survey_number        TEXT,
    sub_division         TEXT,
    old_survey_subdivision TEXT,
    tenure_flag          TEXT,   -- 'P' = ryotwari patta land, blank = government
    tenure_type          TEXT,   -- ரயத்துவாரி / அரசு etc.
    land_use             TEXT,   -- புஞ்சை (dry) / நன்செய் (wet) / புறம்போக்கு (govt poromboke) etc.
    irrigation_source     TEXT,
    double_crop           TEXT,
    soil_type_code         TEXT,
    soil_grade             TEXT,
    tax_rate_rs            TEXT,
    tax_rate_paise         TEXT,
    area_hectare           TEXT,
    area_are               TEXT,
    total_tax_rs            TEXT,
    total_tax_paise         TEXT,
    page                    INTEGER
);

-- Per-survey-number subtotal (only present when a survey number has
-- more than one sub-division; single-subdivision survey numbers have
-- no separate total line in the source document)
CREATE TABLE IF NOT EXISTS areg_survey_totals (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    village_id          INTEGER NOT NULL REFERENCES villages(village_id),
    survey_number       TEXT,
    total_area_hectare  TEXT,
    total_area_are      TEXT,
    total_tax_rs        TEXT,
    total_tax_paise     TEXT,
    page                INTEGER
);

-- Placeholder for GIS survey-boundary coordinates (Module 1 asks for
-- this as an output, but neither Chitta nor A-Reg contains geometry --
-- see docs/README.md "GIS coordinates" note). Populate this later from
-- FMB sketches / TN DILRMP shapefiles, keyed by survey_number.
CREATE TABLE IF NOT EXISTS gis_coordinates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    village_id    INTEGER NOT NULL REFERENCES villages(village_id),
    survey_number TEXT,
    geometry_wkt  TEXT,   -- e.g. POLYGON(...) in WGS84
    source        TEXT    -- e.g. 'FMB 2024', 'DILRMP'
);

CREATE INDEX IF NOT EXISTS idx_chitta_survey_survey_number ON chitta_survey(survey_number);
CREATE INDEX IF NOT EXISTS idx_areg_survey_number ON areg_subdivisions(survey_number);
CREATE INDEX IF NOT EXISTS idx_areg_totals_survey_number ON areg_survey_totals(survey_number);
CREATE INDEX IF NOT EXISTS idx_gis_survey_number ON gis_coordinates(survey_number);
