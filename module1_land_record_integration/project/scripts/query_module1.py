#!/usr/bin/env python3
"""
query_module1.py
------------------
Module 1 (Land Record Integration) query tool.

Input:  Village, Taluk, District, Survey Number
Output: Land ownership details, extent, patta information, GIS coordinates
        (as specified in the project's Module 1 input/output spec)

Usage:
    python3 query_module1.py --village achalvadi --survey 5
    python3 query_module1.py --village achalvadi --taluk Harur --district Dharmapuri --survey 116
    python3 query_module1.py --village achalvadi --patta 9      # look up by Patta number instead

Run without --survey/--patta to just confirm the village exists and see
its record counts.
"""

import argparse
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "db" / "land_records.db"


def get_village_id(conn, village, taluk=None, district=None):
    q = "SELECT village_id, district, taluk, village FROM villages WHERE village = ? COLLATE NOCASE"
    params = [village]
    if taluk:
        q += " AND taluk = ? COLLATE NOCASE"
        params.append(taluk)
    if district:
        q += " AND district = ? COLLATE NOCASE"
        params.append(district)
    rows = conn.execute(q, params).fetchall()
    return rows


def print_patta_block(conn, patta_id, patta_number):
    print(f"\n--- Patta No. {patta_number} ---")
    owners = conn.execute(
        """SELECT seq_no, sub_index, relative_name, relation, owner_name
           FROM chitta_owners WHERE patta_id=? ORDER BY CAST(seq_no AS INTEGER)""",
        (patta_id,),
    ).fetchall()
    print("Owners:")
    for seq_no, sub_index, relative_name, relation, owner_name in owners:
        rel = f"{relative_name} {relation}".strip() if relative_name else relation
        print(f"  {seq_no}. {owner_name}  ({rel})")

    survey = conn.execute(
        """SELECT survey_number, sub_division, nanjai_area, nanjai_tax,
                  punjai_area, punjai_tax, other_area, other_tax, remarks, is_total_row
           FROM chitta_survey WHERE patta_id=? ORDER BY is_total_row, CAST(seq_no AS INTEGER)""",
        (patta_id,),
    ).fetchall()
    print("Extent (Chitta):")
    print(f"  {'Survey-Sub':<14}{'Nanjai(wet)':<20}{'Punjai(dry)':<20}{'Other':<20}{'Remarks'}")
    for sn, sd, na, nt, pa, pt, oa, ot, remarks, is_total in survey:
        label = "TOTAL" if is_total else f"{sn}-{sd}"
        nanjai = f"{na} ac /Rs{nt}"
        punjai = f"{pa} ac /Rs{pt}"
        other = f"{oa} ac /Rs{ot}"
        print(f"  {label:<14}{nanjai:<20}{punjai:<20}{other:<20}{remarks}")


def query_by_survey(conn, village_id, survey_number):
    print(f"\n{'='*70}\nMODULE 1 OUTPUT -- Survey Number {survey_number}\n{'='*70}")

    # 1) Ownership + extent, via Chitta (patta-based)
    pattas = conn.execute(
        """SELECT DISTINCT p.patta_id, p.patta_number
           FROM chitta_survey s JOIN chitta_pattas p ON p.patta_id = s.patta_id
           WHERE p.village_id=? AND s.survey_number=? AND s.is_total_row=0""",
        (village_id, survey_number),
    ).fetchall()

    if not pattas:
        print(f"No Chitta (ownership) records found for survey number {survey_number}.")
    else:
        for patta_id, patta_number in pattas:
            print_patta_block(conn, patta_id, patta_number)

    # 2) Land classification, via A-Reg (survey-based)
    subs = conn.execute(
        """SELECT sub_division, tenure_type, land_use, irrigation_source, soil_type_code,
                  soil_grade, area_hectare, area_are, total_tax_rs, total_tax_paise
           FROM areg_subdivisions WHERE village_id=? AND survey_number=?""",
        (village_id, survey_number),
    ).fetchall()
    print(f"\n--- A-Register land classification for Survey No. {survey_number} ---")
    if subs:
        for sd, tenure, use, irrig, soil_c, soil_g, ha, are, tax_rs, tax_p in subs:
            print(f"  Sub-division {sd or '-'}: {tenure}, {use}, irrigation={irrig or '-'}, "
                  f"soil={soil_c}/{soil_g}, area={ha}Ha {are}Ar, tax=Rs.{tax_rs}.{tax_p}")
    else:
        print("  No A-Reg records found for this survey number.")

    total = conn.execute(
        """SELECT total_area_hectare, total_area_are, total_tax_rs, total_tax_paise
           FROM areg_survey_totals WHERE village_id=? AND survey_number=?""",
        (village_id, survey_number),
    ).fetchone()
    if total:
        print(f"  Survey-number total area: {total[0]}Ha {total[1]}Ar, total tax: Rs.{total[2]}.{total[3]}")

    # 3) GIS coordinates (placeholder -- see docs/README.md)
    gis = conn.execute(
        "SELECT geometry_wkt, source FROM gis_coordinates WHERE village_id=? AND survey_number=?",
        (village_id, survey_number),
    ).fetchone()
    print("\n--- GIS coordinates ---")
    if gis:
        print(f"  {gis[0]}  (source: {gis[1]})")
    else:
        print("  Not available. Chitta/A-Reg text records contain no geometry;")
        print("  populate the gis_coordinates table from an FMB sketch or DILRMP")
        print("  shapefile for this village to enable this output (see Module 6).")


def query_by_patta(conn, village_id, patta_number):
    row = conn.execute(
        "SELECT patta_id FROM chitta_pattas WHERE village_id=? AND patta_number=?",
        (village_id, patta_number),
    ).fetchone()
    if not row:
        print(f"No patta numbered {patta_number} found for this village.")
        return
    print_patta_block(conn, row[0], patta_number)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--village", required=True)
    ap.add_argument("--taluk")
    ap.add_argument("--district")
    ap.add_argument("--survey", help="Survey number to look up")
    ap.add_argument("--patta", help="Patta number to look up (alternative to --survey)")
    args = ap.parse_args()

    conn = sqlite3.connect(DB_PATH)
    matches = get_village_id(conn, args.village, args.taluk, args.district)

    if not matches:
        print(f"No village found matching village='{args.village}' taluk='{args.taluk}' district='{args.district}'.")
        print("Check config/villages.csv and re-run scripts/build_db.py if you just added a new village.")
        return
    if len(matches) > 1:
        print("Multiple villages matched -- please narrow with --taluk/--district:")
        for vid, d, t, v in matches:
            print(f"  {v}, {t}, {d}")
        return

    village_id, district, taluk, village = matches[0]
    print(f"Village: {village} | Taluk: {taluk} | District: {district}")

    if args.survey:
        query_by_survey(conn, village_id, args.survey)
    elif args.patta:
        query_by_patta(conn, village_id, args.patta)
    else:
        n_pattas = conn.execute(
            "SELECT COUNT(*) FROM chitta_pattas WHERE village_id=?", (village_id,)
        ).fetchone()[0]
        n_surveys = conn.execute(
            "SELECT COUNT(DISTINCT survey_number) FROM areg_subdivisions WHERE village_id=?", (village_id,)
        ).fetchone()[0]
        print(f"This village has {n_pattas} patta records and {n_surveys} distinct survey numbers loaded.")
        print("Re-run with --survey <N> or --patta <N> to look up a specific record.")

    conn.close()


if __name__ == "__main__":
    main()
