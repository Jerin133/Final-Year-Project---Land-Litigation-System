#!/usr/bin/env python3
"""
build_db.py
------------
Creates (or refreshes) the Module 1 SQLite database and loads every
village's processed Chitta + A-Reg CSVs into it, using config/villages.csv
to know each village's district/taluk.

Usage:
    python3 build_db.py [--reset]

Reads:
    config/villages.csv
    data/processed/<village>/<village>_chitta_owners.csv
    data/processed/<village>/<village>_chitta_survey.csv
    data/processed/<village>/<village>_areg_subdivisions.csv
    data/processed/<village>/<village>_areg_survey_totals.csv

Writes:
    db/land_records.db
"""

import csv
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "db" / "land_records.db"
SCHEMA_PATH = ROOT / "db" / "schema.sql"
VILLAGES_CSV = ROOT / "config" / "villages.csv"
PROCESSED_DIR = ROOT / "data" / "processed"


def read_csv(path: Path):
    if not path.exists():
        print(f"  (skipping, not found: {path})")
        return []
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def main():
    reset = "--reset" in sys.argv
    if reset and DB_PATH.exists():
        DB_PATH.unlink()
        print(f"Removed existing {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))

    villages = read_csv(VILLAGES_CSV)
    if not villages:
        print("ERROR: config/villages.csv has no rows. Add district,taluk,village for each village.")
        sys.exit(1)

    for v in villages:
        district, taluk, village = v["district"].strip(), v["taluk"].strip(), v["village"].strip()
        print(f"\n=== Loading {village} ({taluk}, {district}) ===")

        cur = conn.execute(
            "INSERT OR IGNORE INTO villages (district, taluk, village) VALUES (?,?,?)",
            (district, taluk, village),
        )
        village_id = conn.execute(
            "SELECT village_id FROM villages WHERE district=? AND taluk=? AND village=?",
            (district, taluk, village),
        ).fetchone()[0]

        vdir = PROCESSED_DIR / village

        # --- Chitta: pattas + owners + survey extent ---
        owners = read_csv(vdir / f"{village}_chitta_owners.csv")
        survey = read_csv(vdir / f"{village}_chitta_survey.csv")
        patta_numbers = sorted({r["patta_number"] for r in owners} | {r["patta_number"] for r in survey})

        patta_id_map = {}
        for pn in patta_numbers:
            conn.execute(
                "INSERT OR IGNORE INTO chitta_pattas (village_id, patta_number) VALUES (?,?)",
                (village_id, pn),
            )
            pid = conn.execute(
                "SELECT patta_id FROM chitta_pattas WHERE village_id=? AND patta_number=?",
                (village_id, pn),
            ).fetchone()[0]
            patta_id_map[pn] = pid

        conn.executemany(
            """INSERT INTO chitta_owners
               (patta_id, seq_no, sub_index, relative_name, relation, owner_name)
               VALUES (?,?,?,?,?,?)""",
            [(patta_id_map[r["patta_number"]], r["seq_no"], r["sub_index"],
              r["relative_name"], r["relation"], r["owner_name"]) for r in owners],
        )
        print(f"  chitta_owners: {len(owners)} rows")

        conn.executemany(
            """INSERT INTO chitta_survey
               (patta_id, seq_no, survey_subdivision_raw, survey_number, sub_division,
                is_total_row, nanjai_area, nanjai_tax, punjai_area, punjai_tax,
                other_area, other_tax, remarks)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [(patta_id_map[r["patta_number"]], r["seq_no"], r["survey_subdivision_raw"],
              r["survey_number"], r["sub_division"], 1 if r["is_total_row"] in ("True", "1") else 0,
              r["nanjai_area"], r["nanjai_tax"], r["punjai_area"], r["punjai_tax"],
              r["other_area"], r["other_tax"], r["remarks"]) for r in survey],
        )
        print(f"  chitta_survey: {len(survey)} rows")

        # --- A-Reg: subdivision land classification + survey totals ---
        areg_sub = read_csv(vdir / f"{village}_areg_subdivisions.csv")
        areg_tot = read_csv(vdir / f"{village}_areg_survey_totals.csv")

        conn.executemany(
            """INSERT INTO areg_subdivisions
               (village_id, survey_number, sub_division, old_survey_subdivision,
                tenure_flag, tenure_type, land_use, irrigation_source, double_crop,
                soil_type_code, soil_grade, tax_rate_rs, tax_rate_paise,
                area_hectare, area_are, total_tax_rs, total_tax_paise, page)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [(village_id, r["survey_number"], r["sub_division"], r["old_survey_subdivision"],
              r["tenure_flag"], r["tenure_type"], r["land_use"], r["irrigation_source"],
              r["double_crop"], r["soil_type_code"], r["soil_grade"], r["tax_rate_rs"],
              r["tax_rate_paise"], r["area_hectare"], r["area_are"], r["total_tax_rs"],
              r["total_tax_paise"], r["page"]) for r in areg_sub],
        )
        print(f"  areg_subdivisions: {len(areg_sub)} rows")

        conn.executemany(
            """INSERT INTO areg_survey_totals
               (village_id, survey_number, total_area_hectare, total_area_are,
                total_tax_rs, total_tax_paise, page)
               VALUES (?,?,?,?,?,?,?)""",
            [(village_id, r["survey_number"], r["total_area_hectare"], r["total_area_are"],
              r["total_tax_rs"], r["total_tax_paise"], r["page"]) for r in areg_tot],
        )
        print(f"  areg_survey_totals: {len(areg_tot)} rows")

    conn.commit()
    print(f"\nDatabase ready at {DB_PATH}")
    conn.close()


if __name__ == "__main__":
    main()
