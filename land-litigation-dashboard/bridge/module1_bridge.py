"""
Module 1 HTTP bridge with Admin Land Record Ingestion.

Module 1 (Land Record Integration) exposes the SQLite database as JSON for citizen/gov
dashboards, and provides Admin endpoints for:
- Ingestion: upload single/multiple PDFs (Chitta + A-Reg) or bulk ZIP,
  parse via parse_areg.py & parse_chitta.py, update config/villages.csv, and
  seamlessly integrate into land_records.db.

Run (from this folder):
    uvicorn module1_bridge:app --port 8001
"""
from __future__ import annotations

import csv
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware

MODULE1_ROOT = (Path(__file__).resolve().parent.parent.parent
                / "module1_land_record_integration" / "project")
DEFAULT_DB = MODULE1_ROOT / "db" / "land_records.db"
DB_PATH = Path(os.environ.get("LAND_DB_PATH", DEFAULT_DB))
VILLAGES_CSV = MODULE1_ROOT / "config" / "villages.csv"
RAW_DATA_DIR = MODULE1_ROOT / "data" / "raw"
PROCESSED_DATA_DIR = MODULE1_ROOT / "data" / "processed"
SCRIPTS_DIR = MODULE1_ROOT / "scripts"

app = FastAPI(title="Module 1 Bridge & Land Record Administration", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------------------------------------------------------------------------
# Database Helpers
# ---------------------------------------------------------------------------
def connect() -> sqlite3.Connection:
    target = DB_PATH
    if not target.exists() and DEFAULT_DB.exists():
        target = DEFAULT_DB
    if not target.exists():
        raise HTTPException(503, f"land_records.db not found at {target}. Set LAND_DB_PATH to valid path.")
    conn = sqlite3.connect(f"file:{target.as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def write_connect() -> sqlite3.Connection:
    target = DB_PATH
    if not target.exists() and DEFAULT_DB.exists():
        target = DEFAULT_DB
    if not target.exists():
        raise HTTPException(503, f"land_records.db not found at {target}.")
    conn = sqlite3.connect(str(target), timeout=30.0)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn


def find_village(conn, village: str):
    row = conn.execute(
        "SELECT village_id, district, taluk, village FROM villages WHERE village = ? COLLATE NOCASE",
        (village,),
    ).fetchone()
    if not row:
        raise HTTPException(404, f"Village '{village}' not found in Module 1.")
    return row


def clean_tamil_text(text: str | None) -> str | None:
    if not text or not isinstance(text, str):
        return text
    # Remove artificial whitespace after virama (pulli \u0BCD) before any Tamil character
    s = re.sub(r'(\u0BCD)\s+(?=[\u0B80-\u0BFF])', r'\1', text)
    # Remove space before dot in initials
    s = re.sub(r'([\u0B80-\u0BFF])\s+\.', r'\1.', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


# ---------------------------------------------------------------------------
# Core Read-Only Endpoints (Existing - Unchanged)
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    conn = connect()
    try:
        n = conn.execute("SELECT COUNT(*) FROM villages").fetchone()[0]
    finally:
        conn.close()
    return {"status": "ok", "villages": n, "db": DB_PATH.name}


@app.get("/villages")
def villages():
    conn = connect()
    try:
        rows = conn.execute("SELECT village_id, district, taluk, village FROM villages ORDER BY village").fetchall()
        out = []
        for r in rows:
            surveys = conn.execute(
                "SELECT COUNT(DISTINCT survey_number) FROM areg_subdivisions WHERE village_id=?",
                (r["village_id"],)).fetchone()[0]
            pattas = conn.execute(
                "SELECT COUNT(*) FROM chitta_pattas WHERE village_id=?", (r["village_id"],)).fetchone()[0]
            out.append({"village": r["village"], "taluk": r["taluk"], "district": r["district"],
                        "survey_count": surveys, "patta_count": pattas})
    finally:
        conn.close()
    return {"villages": out}


@app.get("/land")
def land(village: str, survey: str):
    """Same content as: query_module1.py --village V --survey N"""
    conn = connect()
    try:
        v = find_village(conn, village)
        vid = v["village_id"]

        pattas = conn.execute(
            """SELECT DISTINCT p.patta_id, p.patta_number
               FROM chitta_survey s JOIN chitta_pattas p ON p.patta_id = s.patta_id
               WHERE p.village_id=? AND s.survey_number=? AND s.is_total_row=0""",
            (vid, survey)).fetchall()
        patta_out = []
        for p in pattas:
            owners = conn.execute(
                """SELECT seq_no, sub_index, relative_name, relation, owner_name FROM chitta_owners
                   WHERE patta_id=? ORDER BY CAST(seq_no AS INTEGER)""", (p["patta_id"],)).fetchall()
            extents = conn.execute(
                """SELECT seq_no, survey_subdivision_raw, survey_number, sub_division, is_total_row,
                          nanjai_area, nanjai_tax, punjai_area, punjai_tax, other_area, other_tax, remarks
                   FROM chitta_survey WHERE patta_id=? ORDER BY is_total_row, CAST(seq_no AS INTEGER)""",
                (p["patta_id"],)).fetchall()
            patta_out.append({
                "patta_number": p["patta_number"],
                "owners": [{
                    "seq_no": o["seq_no"],
                    "sub_index": o["sub_index"],
                    "relative_name": clean_tamil_text(o["relative_name"]),
                    "relation": clean_tamil_text(o["relation"]),
                    "owner_name": clean_tamil_text(o["owner_name"])
                } for o in owners],
                "extents": [{
                    **dict(e),
                    "remarks": clean_tamil_text(e["remarks"])
                } for e in extents]
            })

        classification = conn.execute(
            """SELECT sub_division, old_survey_subdivision, tenure_flag, tenure_type, land_use,
                      irrigation_source, double_crop, soil_type_code, soil_grade,
                      tax_rate_rs, tax_rate_paise, area_hectare, area_are, total_tax_rs, total_tax_paise, page
               FROM areg_subdivisions WHERE village_id=? AND survey_number=?""", (vid, survey)).fetchall()
        total = conn.execute(
            """SELECT total_area_hectare, total_area_are, total_tax_rs, total_tax_paise, page
               FROM areg_survey_totals WHERE village_id=? AND survey_number=?""", (vid, survey)).fetchone()
        gis = conn.execute(
            "SELECT survey_number, geometry_wkt, source FROM gis_coordinates WHERE village_id=? AND survey_number=?",
            (vid, survey)).fetchone()
    finally:
        conn.close()

    found = bool(patta_out or classification)
    return {
        "village": v["village"], "taluk": v["taluk"], "district": v["district"],
        "survey_number": survey, "found": found,
        "pattas": patta_out,
        "classification": [{
            **dict(c),
            "tenure_type": clean_tamil_text(c["tenure_type"]),
            "land_use": clean_tamil_text(c["land_use"]),
            "irrigation_source": clean_tamil_text(c["irrigation_source"])
        } for c in classification],
        "survey_total": dict(total) if total else None,
        "gis": dict(gis) if gis else None,
    }


@app.get("/patta")
def patta_lookup(village: str, patta: str):
    """Query land records by Patta Number: query_module1.py --village V --patta N"""
    conn = connect()
    try:
        v = find_village(conn, village)
        vid = v["village_id"]
        p_clean = patta.strip()

        row = conn.execute(
            "SELECT patta_id, patta_number FROM chitta_pattas WHERE village_id=? AND patta_number=?",
            (vid, p_clean)
        ).fetchone()

        if not row:
            return {
                "village": v["village"], "taluk": v["taluk"], "district": v["district"],
                "patta_number": p_clean, "found": False,
                "pattas": [],
                "classification": [],
                "survey_totals": [],
                "survey_numbers": [],
                "gis": None,
                "gis_list": [],
            }

        pid = row["patta_id"]
        owners = conn.execute(
            """SELECT seq_no, sub_index, relative_name, relation, owner_name FROM chitta_owners
               WHERE patta_id=? ORDER BY CAST(seq_no AS INTEGER)""", (pid,)).fetchall()
        extents = conn.execute(
            """SELECT seq_no, survey_subdivision_raw, survey_number, sub_division, is_total_row,
                      nanjai_area, nanjai_tax, punjai_area, punjai_tax, other_area, other_tax, remarks
               FROM chitta_survey WHERE patta_id=? ORDER BY is_total_row, CAST(seq_no AS INTEGER)""",
            (pid,)).fetchall()

        patta_out = [{
            "patta_number": row["patta_number"],
            "owners": [{
                "seq_no": o["seq_no"],
                "sub_index": o["sub_index"],
                "relative_name": clean_tamil_text(o["relative_name"]),
                "relation": clean_tamil_text(o["relation"]),
                "owner_name": clean_tamil_text(o["owner_name"])
            } for o in owners],
            "extents": [{
                **dict(e),
                "remarks": clean_tamil_text(e["remarks"])
            } for e in extents]
        }]

        # Collect distinct survey numbers linked to this patta
        survey_numbers = []
        for e in extents:
            sn = str(e["survey_number"]).strip()
            if sn and not e["is_total_row"] and sn not in survey_numbers:
                survey_numbers.append(sn)

        # Classification and totals for all survey numbers covered by this patta
        classification = []
        survey_totals = []
        gis_list = []
        for sn in survey_numbers:
            c_rows = conn.execute(
                """SELECT survey_number, sub_division, old_survey_subdivision, tenure_flag, tenure_type, land_use,
                          irrigation_source, double_crop, soil_type_code, soil_grade,
                          tax_rate_rs, tax_rate_paise, area_hectare, area_are, total_tax_rs, total_tax_paise, page
                   FROM areg_subdivisions WHERE village_id=? AND survey_number=?""", (vid, sn)).fetchall()
            classification.extend([{
                **dict(r),
                "tenure_type": clean_tamil_text(r["tenure_type"]),
                "land_use": clean_tamil_text(r["land_use"]),
                "irrigation_source": clean_tamil_text(r["irrigation_source"])
            } for r in c_rows])

            tot = conn.execute(
                """SELECT survey_number, total_area_hectare, total_area_are, total_tax_rs, total_tax_paise, page
                   FROM areg_survey_totals WHERE village_id=? AND survey_number=?""", (vid, sn)).fetchone()
            if tot:
                survey_totals.append(dict(tot))

            g = conn.execute(
                "SELECT survey_number, geometry_wkt, source FROM gis_coordinates WHERE village_id=? AND survey_number=?",
                (vid, sn)).fetchone()
            if g:
                gis_list.append(dict(g))
    finally:
        conn.close()

    return {
        "village": v["village"], "taluk": v["taluk"], "district": v["district"],
        "patta_number": p_clean, "found": True,
        "pattas": patta_out,
        "classification": classification,
        "survey_totals": survey_totals,
        "survey_numbers": survey_numbers,
        "gis": gis_list[0] if gis_list else None,
        "gis_list": gis_list,
    }



@app.get("/tenure")
def tenure(village: str, surveys: str = Query(..., description="comma-separated survey numbers")):
    """A-Register tenure for many survey numbers at once. The government
    dashboard uses it to see whether disputed land is government or patta land."""
    nums = [s.strip() for s in surveys.split(",") if s.strip()]
    result: dict = {}
    conn = connect()
    try:
        vid = find_village(conn, village)["village_id"]
        for start in range(0, len(nums), 500):
            chunk = nums[start:start + 500]
            marks = ",".join("?" * len(chunk))
            rows = conn.execute(
                f"""SELECT survey_number, sub_division, tenure_type, land_use
                    FROM areg_subdivisions WHERE village_id=? AND survey_number IN ({marks})""",
                [vid, *chunk]).fetchall()
            for r in rows:
                result.setdefault(r["survey_number"], []).append(
                    {"sub_division": r["sub_division"], "tenure_type": r["tenure_type"],
                     "land_use": r["land_use"]})
    finally:
        conn.close()
    return {"village": village, "tenure": result}


# ---------------------------------------------------------------------------
# Module 1 Ingestion Logic (Parsing & SQLite DB Update)
# ---------------------------------------------------------------------------
def read_csv_data(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def sync_village_into_db(conn: sqlite3.Connection, district: str, taluk: str, village: str, is_replace: bool) -> dict:
    district_clean = district.strip()
    taluk_clean = taluk.strip()
    village_clean = village.strip().lower()

    row = conn.execute(
        "SELECT village_id FROM villages WHERE village = ? COLLATE NOCASE",
        (village_clean,)
    ).fetchone()

    if row and is_replace:
        vid = row[0]
        # Cleanly wipe old village data in proper dependency order
        conn.execute("DELETE FROM gis_coordinates WHERE village_id=?", (vid,))
        conn.execute("DELETE FROM areg_survey_totals WHERE village_id=?", (vid,))
        conn.execute("DELETE FROM areg_subdivisions WHERE village_id=?", (vid,))
        conn.execute("DELETE FROM chitta_survey WHERE patta_id IN (SELECT patta_id FROM chitta_pattas WHERE village_id=?)", (vid,))
        conn.execute("DELETE FROM chitta_owners WHERE patta_id IN (SELECT patta_id FROM chitta_pattas WHERE village_id=?)", (vid,))
        conn.execute("DELETE FROM chitta_pattas WHERE village_id=?", (vid,))
        conn.execute("UPDATE villages SET district=?, taluk=?, village=? WHERE village_id=?",
                     (district_clean, taluk_clean, village_clean, vid))
        village_id = vid
    elif row:
        village_id = row[0]
    else:
        cur = conn.execute(
            "INSERT INTO villages (district, taluk, village) VALUES (?,?,?)",
            (district_clean, taluk_clean, village_clean)
        )
        village_id = cur.lastrowid

    # Load processed CSVs
    vdir = PROCESSED_DATA_DIR / village_clean
    owners = read_csv_data(vdir / f"{village_clean}_chitta_owners.csv")
    survey = read_csv_data(vdir / f"{village_clean}_chitta_survey.csv")
    areg_sub = read_csv_data(vdir / f"{village_clean}_areg_subdivisions.csv")
    areg_tot = read_csv_data(vdir / f"{village_clean}_areg_survey_totals.csv")

    patta_numbers = sorted({r["patta_number"] for r in owners if r.get("patta_number")}
                           | {r["patta_number"] for r in survey if r.get("patta_number")})

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

    if owners:
        conn.executemany(
            """INSERT INTO chitta_owners
               (patta_id, seq_no, sub_index, relative_name, relation, owner_name)
               VALUES (?,?,?,?,?,?)""",
            [(patta_id_map[r["patta_number"]], r.get("seq_no", ""), r.get("sub_index", ""),
              clean_tamil_text(r.get("relative_name", "")),
              clean_tamil_text(r.get("relation", "")),
              clean_tamil_text(r.get("owner_name", "")))
             for r in owners if r.get("patta_number") in patta_id_map],
        )

    if survey:
        conn.executemany(
            """INSERT INTO chitta_survey
               (patta_id, seq_no, survey_subdivision_raw, survey_number, sub_division,
                is_total_row, nanjai_area, nanjai_tax, punjai_area, punjai_tax,
                other_area, other_tax, remarks)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [(patta_id_map[r["patta_number"]], r.get("seq_no", ""), r.get("survey_subdivision_raw", ""),
              r.get("survey_number", ""), r.get("sub_division", ""),
              1 if str(r.get("is_total_row", "")).lower() in ("true", "1") else 0,
              r.get("nanjai_area", ""), r.get("nanjai_tax", ""), r.get("punjai_area", ""), r.get("punjai_tax", ""),
              r.get("other_area", ""), r.get("other_tax", ""),
              clean_tamil_text(r.get("remarks", "")))
             for r in survey if r.get("patta_number") in patta_id_map],
        )

    if areg_sub:
        conn.executemany(
            """INSERT INTO areg_subdivisions
               (village_id, survey_number, sub_division, old_survey_subdivision,
                tenure_flag, tenure_type, land_use, irrigation_source, double_crop,
                soil_type_code, soil_grade, tax_rate_rs, tax_rate_paise,
                area_hectare, area_are, total_tax_rs, total_tax_paise, page)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [(village_id, r.get("survey_number", ""), r.get("sub_division", ""), r.get("old_survey_subdivision", ""),
              r.get("tenure_flag", ""),
              clean_tamil_text(r.get("tenure_type", "")),
              clean_tamil_text(r.get("land_use", "")),
              clean_tamil_text(r.get("irrigation_source", "")),
              r.get("double_crop", ""), r.get("soil_type_code", ""), r.get("soil_grade", ""), r.get("tax_rate_rs", ""),
              r.get("tax_rate_paise", ""), r.get("area_hectare", ""), r.get("area_are", ""), r.get("total_tax_rs", ""),
              r.get("total_tax_paise", ""), r.get("page", 1)) for r in areg_sub],
        )

    if areg_tot:
        conn.executemany(
            """INSERT INTO areg_survey_totals
               (village_id, survey_number, total_area_hectare, total_area_are,
                total_tax_rs, total_tax_paise, page)
               VALUES (?,?,?,?,?,?,?)""",
            [(village_id, r.get("survey_number", ""), r.get("total_area_hectare", ""), r.get("total_area_are", ""),
              r.get("total_tax_rs", ""), r.get("total_tax_paise", ""), r.get("page", 1)) for r in areg_tot],
        )

    conn.commit()

    return {
        "village_id": village_id,
        "village": village_clean,
        "taluk": taluk_clean,
        "district": district_clean,
        "pattas_count": len(patta_numbers),
        "owners_count": len(owners),
        "survey_rows": len(survey),
        "areg_subdivisions": len(areg_sub),
        "areg_totals": len(areg_tot),
    }


def update_villages_csv(district: str, taluk: str, village: str):
    rows = []
    if VILLAGES_CSV.exists():
        with open(VILLAGES_CSV, "r", encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))

    v_clean = village.strip().lower()
    found = False
    for r in rows:
        if r.get("village", "").strip().lower() == v_clean:
            r["taluk"] = taluk.strip()
            r["district"] = district.strip()
            found = True
            break
    if not found:
        rows.append({"village": v_clean, "taluk": taluk.strip(), "district": district.strip()})

    with open(VILLAGES_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["village", "taluk", "district"])
        writer.writeheader()
        writer.writerows(rows)


@app.get("/admin/villages-detailed")
def admin_villages_detailed():
    """Returns detailed status of all villages in config and database."""
    config_rows = []
    if VILLAGES_CSV.exists():
        with open(VILLAGES_CSV, "r", encoding="utf-8-sig") as f:
            config_rows = list(csv.DictReader(f))

    conn = connect()
    try:
        db_rows = conn.execute("SELECT village_id, district, taluk, village FROM villages ORDER BY village").fetchall()
        db_villages = {}
        for r in db_rows:
            vid = r["village_id"]
            surveys = conn.execute("SELECT COUNT(DISTINCT survey_number) FROM areg_subdivisions WHERE village_id=?", (vid,)).fetchone()[0]
            pattas = conn.execute("SELECT COUNT(*) FROM chitta_pattas WHERE village_id=?", (vid,)).fetchone()[0]
            owners = conn.execute(
                "SELECT COUNT(*) FROM chitta_owners WHERE patta_id IN (SELECT patta_id FROM chitta_pattas WHERE village_id=?)",
                (vid,)).fetchone()[0]
            subdivisions = conn.execute("SELECT COUNT(*) FROM areg_subdivisions WHERE village_id=?", (vid,)).fetchone()[0]
            db_villages[r["village"].lower()] = {
                "village_id": vid,
                "district": r["district"],
                "taluk": r["taluk"],
                "village": r["village"],
                "survey_count": surveys,
                "patta_count": pattas,
                "owner_count": owners,
                "subdivision_count": subdivisions,
            }
    finally:
        conn.close()

    result = []
    all_names = sorted(set(list(db_villages.keys()) + [r["village"].strip().lower() for r in config_rows if r.get("village")]))
    for name in all_names:
        db_info = db_villages.get(name, {})
        cfg = next((r for r in config_rows if r.get("village", "").strip().lower() == name), {})

        raw_dir = RAW_DATA_DIR / name
        areg_pdf_exists = (raw_dir / "areg.pdf").exists()
        chitta_pdf_exists = (raw_dir / "chitta.pdf").exists()

        result.append({
            "village": name,
            "district": db_info.get("district") or cfg.get("district", ""),
            "taluk": db_info.get("taluk") or cfg.get("taluk", ""),
            "in_database": bool(db_info),
            "in_config": bool(cfg),
            "areg_pdf": areg_pdf_exists,
            "chitta_pdf": chitta_pdf_exists,
            "survey_count": db_info.get("survey_count", 0),
            "patta_count": db_info.get("patta_count", 0),
            "owner_count": db_info.get("owner_count", 0),
            "subdivision_count": db_info.get("subdivision_count", 0),
        })

    return {"villages": result, "count": len(result)}


@app.post("/admin/land-records/upload")
async def upload_land_records(
    district: str = Form(...),
    taluk: str = Form(...),
    village: str = Form(...),
    action: str = Form("add"),  # 'add' or 'replace'
    areg_file: Optional[UploadFile] = File(None),
    chitta_file: Optional[UploadFile] = File(None),
    zip_file: Optional[UploadFile] = File(None),
):
    """
    Accepts Village details and either:
    1. Single PDFs: areg_file and chitta_file
    2. Bulk ZIP archive containing areg.pdf and chitta.pdf
    Parses the documents and seamlessly writes them into Module 1's SQLite database.
    """
    village_clean = village.strip().lower()
    district_clean = district.strip()
    taluk_clean = taluk.strip()
    is_replace = action.strip().lower() == "replace"

    raw_dir = RAW_DATA_DIR / village_clean
    processed_dir = PROCESSED_DATA_DIR / village_clean
    raw_dir.mkdir(parents=True, exist_ok=True)
    processed_dir.mkdir(parents=True, exist_ok=True)

    areg_dest = raw_dir / "areg.pdf"
    chitta_dest = raw_dir / "chitta.pdf"

    # Step 1: Save PDFs from individual files or ZIP archive
    if zip_file and zip_file.filename:
        zip_bytes = await zip_file.read()
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_zip_path = Path(tmp_dir) / "upload.zip"
            tmp_zip_path.write_bytes(zip_bytes)
            with zipfile.ZipFile(tmp_zip_path, "r") as zf:
                zf.extractall(tmp_dir)

            found_areg = None
            found_chitta = None
            for p in Path(tmp_dir).rglob("*.pdf"):
                name_lower = p.name.lower()
                if any(k in name_lower for k in ("areg", "a_reg", "adangal", "extract")):
                    found_areg = p
                elif any(k in name_lower for k in ("chitta", "patta")):
                    found_chitta = p

            all_pdfs = list(Path(tmp_dir).rglob("*.pdf"))
            if (not found_areg or not found_chitta) and len(all_pdfs) == 2:
                all_pdfs.sort(key=lambda x: x.stat().st_size)
                found_areg = all_pdfs[0]
                found_chitta = all_pdfs[1]

            if not found_areg or not found_chitta:
                raise HTTPException(400, "Could not identify both A-Register and Chitta PDFs inside the uploaded ZIP archive.")

            shutil.copy2(found_areg, areg_dest)
            shutil.copy2(found_chitta, chitta_dest)

    elif areg_file and chitta_file:
        areg_bytes = await areg_file.read()
        chitta_bytes = await chitta_file.read()
        areg_dest.write_bytes(areg_bytes)
        chitta_dest.write_bytes(chitta_bytes)
    elif is_replace and (areg_file or chitta_file):
        if areg_file:
            areg_bytes = await areg_file.read()
            areg_dest.write_bytes(areg_bytes)
        if chitta_file:
            chitta_bytes = await chitta_file.read()
            chitta_dest.write_bytes(chitta_bytes)
    else:
        raise HTTPException(400, "Please upload A-Register & Chitta PDFs, a bulk ZIP archive, or select the specific document to replace.")

    logs = []
    # Step 2: Run parse_areg.py
    if areg_dest.exists():
        parse_areg_script = SCRIPTS_DIR / "parse_areg.py"
        if not parse_areg_script.exists():
            raise HTTPException(500, f"parse_areg.py not found at {parse_areg_script}")

        areg_proc = subprocess.run(
            [sys.executable, str(parse_areg_script), str(areg_dest), village_clean, str(processed_dir)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        logs.append(f"A-Register Parser: {areg_proc.stdout.strip()}")
        if areg_proc.returncode != 0:
            raise HTTPException(500, f"A-Register parsing failed: {areg_proc.stderr}")

    # Step 3: Run parse_chitta.py
    if chitta_dest.exists():
        parse_chitta_script = SCRIPTS_DIR / "parse_chitta.py"
    if not parse_chitta_script.exists():
        raise HTTPException(500, f"parse_chitta.py not found at {parse_chitta_script}")

    chitta_proc = subprocess.run(
        [sys.executable, str(parse_chitta_script), str(chitta_dest), village_clean, str(processed_dir)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace"
    )
    logs.append(f"Chitta Parser: {chitta_proc.stdout.strip()}")
    if chitta_proc.returncode != 0:
        raise HTTPException(500, f"Chitta parsing failed: {chitta_proc.stderr}")

    # Step 4: Update villages.csv
    update_villages_csv(district_clean, taluk_clean, village_clean)
    logs.append("Updated config/villages.csv")

    # Step 5: Update SQLite land_records.db
    write_conn = write_connect()
    try:
        stats = sync_village_into_db(write_conn, district_clean, taluk_clean, village_clean, is_replace)
    finally:
        write_conn.close()

    logs.append(f"Synchronized with database: {stats['pattas_count']} pattas, {stats['areg_subdivisions']} subdivisions.")

    return {
        "status": "success",
        "action": "replace" if is_replace else "add",
        "village": village_clean,
        "district": district_clean,
        "taluk": taluk_clean,
        "stats": stats,
        "logs": logs,
    }


@app.delete("/admin/village/{village_name}")
def delete_village(village_name: str):
    v_clean = village_name.strip().lower()
    conn = write_connect()
    try:
        row = conn.execute("SELECT village_id FROM villages WHERE village = ? COLLATE NOCASE", (v_clean,)).fetchone()
        if not row:
            raise HTTPException(404, f"Village '{village_name}' not found.")
        vid = row[0]
        conn.execute("DELETE FROM gis_coordinates WHERE village_id=?", (vid,))
        conn.execute("DELETE FROM areg_survey_totals WHERE village_id=?", (vid,))
        conn.execute("DELETE FROM areg_subdivisions WHERE village_id=?", (vid,))
        conn.execute("DELETE FROM chitta_survey WHERE patta_id IN (SELECT patta_id FROM chitta_pattas WHERE village_id=?)", (vid,))
        conn.execute("DELETE FROM chitta_owners WHERE patta_id IN (SELECT patta_id FROM chitta_pattas WHERE village_id=?)", (vid,))
        conn.execute("DELETE FROM chitta_pattas WHERE village_id=?", (vid,))
        conn.execute("DELETE FROM villages WHERE village_id=?", (vid,))
        conn.commit()
    finally:
        conn.close()

    # Also remove from config/villages.csv if present
    if VILLAGES_CSV.exists():
        with open(VILLAGES_CSV, "r", encoding="utf-8-sig") as f:
            rows = [r for r in csv.DictReader(f) if r.get("village", "").strip().lower() != v_clean]
        with open(VILLAGES_CSV, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["village", "taluk", "district"])
            writer.writeheader()
            writer.writerows(rows)

    return {"status": "success", "message": f"Village '{village_name}' removed from database."}


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run("module1_bridge:app", host=host, port=port, reload=False)

