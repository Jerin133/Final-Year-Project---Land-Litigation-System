#!/usr/bin/env python3
"""
Kudumiyampatty Land Records GIS  -  single-file runner (Module 6)

Put this file in the SAME folder as  kudumiyampatty_surveys.geojson  and run:

    pip install fastapi "uvicorn[standard]"        # once
    python run_gis.py                              # starts server + opens the browser

Then open  http://localhost:8000
  GET /gis/polygons       all survey polygons (WGS84)
  GET /gis/search/105     polygon of survey 105   (404 "Survey Not Found" otherwise)
  GET /docs               interactive API docs

Adding more villages (no code changes needed):
  Use the "+ Add village" button in the sidebar: type a name, pick a GeoJSON file, done.
  Uploaded files are kept in a  villages/  folder next to this script (+ villages.json) and are
  re-loaded automatically on the next start.  You can also drop a file in that folder by hand
  and list it in villages.json  ->  [{"slug": "x", "name": "X", "file": "x.geojson"}]
  GET  /gis/villages                      list of villages
  POST /gis/villages                      add one  {"name": "...", "geojson": "<file text>"}
  GET  /gis/villages/{slug}/polygons      polygons of one village
  GET  /gis/villages/{slug}/search/105    survey lookup inside one village
  (/gis/polygons and /gis/search/105 still work and always refer to the default village.)

Optional:  python run_gis.py --port 9000 --geojson path/to/file.geojson --no-browser
(The map page loads Leaflet from a CDN, so it needs internet, like the map tiles.)
"""
from __future__ import annotations

import argparse
import sys
import threading
import webbrowser
from contextlib import asynccontextmanager

import hashlib
import json
import logging
import math
import os
import re
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Protocol

logger = logging.getLogger(__name__)

Feature = dict[str, Any]
FeatureCollection = dict[str, Any]
Ring = list[list[float]]
PolygonRings = list[Ring]  # [outer, hole, hole, ...]

DEFAULT_GEOJSON_PATH = Path(__file__).resolve().parent / "kudumiyampatty_surveys.geojson"

_WEB_MERCATOR_RADIUS = 6378137.0
_AUTHALIC_RADIUS = 6371007.2
_COORD_DECIMALS = 7  # ~1 cm; keeps the payload small
_DIGITS = re.compile(r"[0-9]+")

# canonical property name -> accepted source column names (lower-case)
_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "survey_no": ("survey_no", "survey no", "surveyno", "survey_number", "survey number"),
    "area_sqm": ("area", "area_sqm", "area_m2"),
    "owner": ("owner", "owner_name"),
    "subdivision": ("subdiv", "subdivision", "sub_division"),
    "patta_no": ("patta_no", "patta"),
    "village": ("village",),
    "taluk": ("taluk",),
    "district": ("district",),
    "extent": ("extent",),
    "classification": ("classify", "classification"),
}


# --------------------------------------------------------------------------- #
# Public contract
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Payload:
    """Pre-serialised JSON body + strong ETag (for HTTP caching)."""

    body: bytes
    etag: str


class SurveyRepository(Protocol):
    """What the API layer needs. Implement this for SQLite / PostGIS later."""

    def get_polygons_payload(self) -> Payload: ...

    def get_by_survey_no(self, survey_no: str) -> Feature | None: ...

    def count(self) -> int: ...


def normalize_survey_no(raw: Any) -> str:
    """'  0105 ' -> '105',  105.0 -> '105',  '105/2' -> '105/2'.  Always a str."""
    if raw is None:
        return ""
    if isinstance(raw, float) and raw.is_integer():
        raw = int(raw)
    text = " ".join(str(raw).split())
    if _DIGITS.fullmatch(text):
        text = text.lstrip("0") or "0"
    return text


# --------------------------------------------------------------------------- #
# CRS handling
# --------------------------------------------------------------------------- #
def _detect_crs(data: dict[str, Any]) -> str:
    name = str(((data.get("crs") or {}).get("properties") or {}).get("name") or "").upper()
    if name.endswith(("EPSG::3857", "EPSG:3857", "EPSG::900913", "EPSG:900913")):
        return "EPSG:3857"
    if not name or "CRS84" in name or name.endswith(("EPSG::4326", "EPSG:4326")):
        return "EPSG:4326"
    raise ValueError(f"Unsupported CRS '{name}'. Export the layer as EPSG:4326 or EPSG:3857.")


def _web_mercator_to_wgs84(x: float, y: float) -> tuple[float, float]:
    lon = math.degrees(x / _WEB_MERCATOR_RADIUS)
    lat = math.degrees(2.0 * math.atan(math.exp(y / _WEB_MERCATOR_RADIUS)) - math.pi / 2.0)
    return lon, lat


def _identity(x: float, y: float) -> tuple[float, float]:
    return x, y


def _projector(crs: str) -> Callable[[float, float], tuple[float, float]]:
    return _web_mercator_to_wgs84 if crs == "EPSG:3857" else _identity


# --------------------------------------------------------------------------- #
# Geometry helpers (plain Python, no GIS dependencies)
# --------------------------------------------------------------------------- #
def _polygons_of(geometry: dict[str, Any]) -> list[PolygonRings]:
    gtype, coords = geometry.get("type"), geometry.get("coordinates")
    if gtype == "Polygon":
        return [coords]
    if gtype == "MultiPolygon":
        return list(coords)
    raise ValueError(f"Unsupported geometry type: {gtype}")


def _ring_centroid(ring: Ring) -> tuple[float, float, float]:
    """Planar centroid + absolute area of a ring (shoelace, origin-shifted)."""
    ox, oy = ring[0][0], ring[0][1]
    a = cx = cy = 0.0
    for p0, p1 in zip(ring, ring[1:]):
        x0, y0, x1, y1 = p0[0] - ox, p0[1] - oy, p1[0] - ox, p1[1] - oy
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-12:  # degenerate ring
        n = max(len(ring) - 1, 1)
        return (
            sum(p[0] for p in ring[:n]) / n,
            sum(p[1] for p in ring[:n]) / n,
            0.0,
        )
    a *= 0.5
    return ox + cx / (6.0 * a), oy + cy / (6.0 * a), abs(a)


def _point_in_rings(x: float, y: float, rings: PolygonRings) -> bool:
    """Even-odd rule across outer ring and holes."""
    inside = False
    for ring in rings:
        for p0, p1 in zip(ring, ring[1:]):
            x0, y0, x1, y1 = p0[0], p0[1], p1[0], p1[1]
            if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
                inside = not inside
    return inside


def _widest_scanline_point(rings: PolygonRings, y: float) -> tuple[float, float] | None:
    xs: list[float] = []
    for ring in rings:
        for p0, p1 in zip(ring, ring[1:]):
            x0, y0, x1, y1 = p0[0], p0[1], p1[0], p1[1]
            if (y0 > y) != (y1 > y):
                xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
    xs.sort()
    best: tuple[float, float] | None = None
    for i in range(0, len(xs) - 1, 2):
        width = xs[i + 1] - xs[i]
        if best is None or width > best[0]:
            best = (width, (xs[i] + xs[i + 1]) / 2.0)
    return (best[1], y) if best else None


def _label_point(polygons: list[PolygonRings]) -> tuple[float, float]:
    """Centroid of the largest part; falls back to a guaranteed-interior point
    when the centroid of a concave parcel lands outside it."""
    largest = max(polygons, key=lambda rings: _ring_centroid(rings[0])[2])
    cx, cy, _ = _ring_centroid(largest[0])
    if _point_in_rings(cx, cy, largest):
        return cx, cy
    return _widest_scanline_point(largest, cy) or (largest[0][0][0], largest[0][0][1])


def _sphere_ring_area(ring: Ring) -> float:
    """Chamberlain-Duquette spherical ring area (m²) for lon/lat degrees."""
    total = 0.0
    for p0, p1 in zip(ring, ring[1:]):
        total += math.radians(p1[0] - p0[0]) * (
            2.0 + math.sin(math.radians(p0[1])) + math.sin(math.radians(p1[1]))
        )
    return abs(total) * _AUTHALIC_RADIUS**2 / 2.0


def _fallback_area(polygons_wgs84: list[PolygonRings]) -> float:
    area = 0.0
    for rings in polygons_wgs84:
        area += _sphere_ring_area(rings[0]) - sum(_sphere_ring_area(h) for h in rings[1:])
    return round(area, 2)


# --------------------------------------------------------------------------- #
# Attribute helpers
# --------------------------------------------------------------------------- #
def _clean(value: Any) -> Any:
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def _extract_properties(raw: dict[str, Any]) -> dict[str, Any]:
    lookup = {str(k).strip().lower(): _clean(v) for k, v in (raw or {}).items()}
    out: dict[str, Any] = {}
    for canonical, aliases in _FIELD_ALIASES.items():
        out[canonical] = next((lookup[a] for a in aliases if lookup.get(a) is not None), None)
    out["fid"] = lookup.get("id") if lookup.get("id") is not None else lookup.get("fid")
    return out


def _to_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


# --------------------------------------------------------------------------- #
# Repository implementation
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class _Loaded:
    payload: Payload
    index: dict[str, Feature]


class GeoJSONSurveyRepository:
    """Loads the file once, then serves everything from memory."""

    def __init__(self, path: Path | str = DEFAULT_GEOJSON_PATH) -> None:
        self._path = Path(path)
        self._lock = threading.Lock()
        self._loaded: _Loaded | None = None

    # -- SurveyRepository ---------------------------------------------------
    def get_polygons_payload(self) -> Payload:
        return self._state().payload

    def get_by_survey_no(self, survey_no: str) -> Feature | None:
        return self._state().index.get(normalize_survey_no(survey_no))

    def count(self) -> int:
        return len(self._state().index)

    # -- extras -------------------------------------------------------------
    def reload(self) -> None:
        """Re-read the file (e.g. after re-exporting from QGIS)."""
        with self._lock:
            self._loaded = self._load()

    # -- internals ----------------------------------------------------------
    def _state(self) -> _Loaded:
        if self._loaded is None:
            with self._lock:
                if self._loaded is None:
                    self._loaded = self._load()
        return self._loaded

    def _load(self) -> _Loaded:
        if not self._path.is_file():
            raise FileNotFoundError(f"GeoJSON file not found: {self._path}")
        with self._path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        if data.get("type") != "FeatureCollection":
            raise ValueError("GeoJSON root must be a FeatureCollection")

        project = _projector(_detect_crs(data))
        features: list[Feature] = []
        index: dict[str, Feature] = {}
        skipped = 0

        for position, source in enumerate(data.get("features", []), start=1):
            try:
                feature = self._build_feature(source, project)
            except ValueError as exc:
                skipped += 1
                logger.warning("Skipping feature #%d: %s", position, exc)
                continue
            survey_no = feature["properties"]["survey_no"]
            if survey_no in index:
                logger.warning(
                    "Duplicate survey_no '%s' (feature #%d); search returns the first.",
                    survey_no,
                    position,
                )
            else:
                index[survey_no] = feature
            features.append(feature)

        if not features:
            raise ValueError("No valid survey polygons found in the GeoJSON file")

        xs = [f["bbox"][0] for f in features] + [f["bbox"][2] for f in features]
        ys = [f["bbox"][1] for f in features] + [f["bbox"][3] for f in features]
        collection: FeatureCollection = {
            "type": "FeatureCollection",
            "name": data.get("name", self._path.stem),
            "bbox": [min(xs), min(ys), max(xs), max(ys)],
            "features": features,
        }
        body = json.dumps(collection, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        etag = '"' + hashlib.sha256(body).hexdigest()[:20] + '"'
        logger.info(
            "Loaded %d survey polygons from %s (%d skipped, %d KB)",
            len(features),
            self._path.name,
            skipped,
            len(body) // 1024,
        )
        return _Loaded(Payload(body=body, etag=etag), index)

    @staticmethod
    def _build_feature(
        source: dict[str, Any], project: Callable[[float, float], tuple[float, float]]
    ) -> Feature:
        geometry = source.get("geometry")
        if not geometry:
            raise ValueError("missing geometry")
        props = _extract_properties(source.get("properties") or {})
        survey_no = normalize_survey_no(props["survey_no"])
        if not survey_no:
            raise ValueError("missing survey number")

        polygons = _polygons_of(geometry)
        if not polygons or not all(rings and len(rings[0]) >= 4 for rings in polygons):
            raise ValueError(f"survey {survey_no}: invalid polygon rings")

        label_x, label_y = _label_point(polygons)  # computed in the source CRS
        label_lon, label_lat = project(label_x, label_y)

        min_x = min_y = math.inf
        max_x = max_y = -math.inf
        projected_polygons: list[PolygonRings] = []
        for rings in polygons:
            projected_rings: PolygonRings = []
            for ring in rings:
                out: Ring = []
                for point in ring:
                    lon, lat = project(point[0], point[1])
                    lon, lat = round(lon, _COORD_DECIMALS), round(lat, _COORD_DECIMALS)
                    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                        raise ValueError(f"survey {survey_no}: coordinates outside WGS84 range")
                    out.append([lon, lat])
                    min_x, max_x = min(min_x, lon), max(max_x, lon)
                    min_y, max_y = min(min_y, lat), max(max_y, lat)
                projected_rings.append(out)
            projected_polygons.append(projected_rings)

        area = _to_float(props["area_sqm"])
        if area is None:
            area = _fallback_area(projected_polygons)

        properties = {k: v for k, v in props.items() if k != "area_sqm"}
        properties["survey_no"] = survey_no
        properties["area_sqm"] = round(area, 2)
        properties["centroid_lat"] = round(label_lat, _COORD_DECIMALS)
        properties["centroid_lng"] = round(label_lon, _COORD_DECIMALS)

        return {
            "type": "Feature",
            "id": survey_no,
            "bbox": [min_x, min_y, max_x, max_y],
            "properties": properties,
            "geometry": {"type": "MultiPolygon", "coordinates": projected_polygons},
        }


# --------------------------------------------------------------------------- #
# Multi-village registry  (the original village stays the default)
# --------------------------------------------------------------------------- #
VILLAGES_DIR = Path(os.getenv("GIS_VILLAGES_DIR", str(Path(__file__).resolve().parent / "villages")))
MAX_UPLOAD_BYTES = 60 * 1024 * 1024
MAX_NAME_LEN = 60
DEFAULT_SQLITE_PATH = (
    Path(__file__).resolve().parent.parent
    / "module1_land_record_integration"
    / "project"
    / "db"
    / "land_records.db"
)
SQLITE_DB_PATH = Path(os.getenv("LAND_DB_PATH", str(DEFAULT_SQLITE_PATH)))


def _geom_to_wkt(geometry: dict[str, Any]) -> str:
    """Convert GeoJSON geometry (Polygon / MultiPolygon) to standard WKT."""
    gtype = geometry.get("type")
    coords = geometry.get("coordinates", [])
    if gtype == "Polygon":
        rings = [f"({', '.join(f'{p[0]} {p[1]}' for p in r)})" for r in coords]
        return f"POLYGON ({', '.join(rings)})"
    elif gtype == "MultiPolygon":
        polys = []
        for poly in coords:
            rings = [f"({', '.join(f'{p[0]} {p[1]}' for p in r)})" for r in poly]
            polys.append(f"({', '.join(rings)})")
        return f"MULTIPOLYGON ({', '.join(polys)})"
    return json.dumps(geometry)


def _sync_village_to_sqlite(
    db_path: Path, slug: str, name: str, repo: SurveyRepository, filename: str
) -> None:
    """Persist village metadata and parcel geometries into SQLite tables."""
    if not db_path.is_file():
        logger.warning("SQLite DB not found at %s; skipping GIS SQLite sync", db_path)
        return
    try:
        conn = sqlite3.connect(str(db_path), timeout=20.0)
        cur = conn.cursor()

        # 1. Ensure tables exist
        cur.execute("""
            CREATE TABLE IF NOT EXISTS gis_villages (
                slug TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                filename TEXT NOT NULL,
                parcel_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS gis_coordinates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                village_id INTEGER NOT NULL REFERENCES villages(village_id),
                survey_number TEXT,
                geometry_wkt TEXT,
                source TEXT
            )
        """)

        # 2. Match or create village entry in villages table
        v_row = cur.execute(
            "SELECT village_id FROM villages WHERE LOWER(village) = LOWER(?)", (name,)
        ).fetchone()
        if v_row:
            village_id = v_row[0]
        else:
            cur.execute(
                "INSERT INTO villages (district, taluk, village) VALUES (?, ?, ?)",
                ("Dharmapuri", "Harur", name.lower()),
            )
            village_id = cur.lastrowid

        # 3. Insert or update gis_villages registry
        parcel_count = repo.count()
        cur.execute(
            "INSERT OR REPLACE INTO gis_villages (slug, name, filename, parcel_count) VALUES (?, ?, ?, ?)",
            (slug, name, filename, parcel_count),
        )

        # 4. Insert or refresh parcel coordinates in gis_coordinates
        cur.execute("DELETE FROM gis_coordinates WHERE village_id = ?", (village_id,))
        if hasattr(repo, "_state"):
            features = list(repo._state().index.values())
            for feat in features:
                s_no = str(feat.get("properties", {}).get("survey_no") or "").strip()
                geom = feat.get("geometry")
                if s_no and geom:
                    wkt = _geom_to_wkt(geom)
                    cur.execute(
                        "INSERT INTO gis_coordinates (village_id, survey_number, geometry_wkt, source) VALUES (?, ?, ?, ?)",
                        (village_id, s_no, wkt, filename),
                    )

        conn.commit()
        conn.close()
        logger.info(
            "Synced GIS village '%s' (%d parcels) into SQLite at %s",
            name,
            parcel_count,
            db_path.name,
        )
    except Exception as exc:
        logger.warning("Failed to sync GIS village '%s' to SQLite: %s", name, exc)


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60].strip("-")
    # names written only in Tamil/other scripts have no ASCII letters -> stable hash slug
    return slug or "village-" + hashlib.sha1(name.encode("utf-8")).hexdigest()[:8]


def _default_village_name(path: Path | str) -> str:
    stem = Path(path).stem
    stem = re.sub(r"[_\- ]*surveys?$", "", stem, flags=re.I) or stem
    return stem.replace("_", " ").replace("-", " ").strip().title()


class VillageRegistry:
    """slug -> (display name, repository). Persists both to villages/ and SQLite."""

    def __init__(
        self,
        default_repo: SurveyRepository,
        default_name: str,
        directory: Path | str = VILLAGES_DIR,
        db_path: Path | str = SQLITE_DB_PATH,
    ) -> None:
        self._dir = Path(directory)
        self._db_path = Path(db_path)
        self._index_file = self._dir / "villages.json"
        self._lock = threading.Lock()
        self.default_slug = _slugify(default_name)
        self._villages: dict[str, dict[str, Any]] = {
            self.default_slug: {
                "name": default_name,
                "repo": default_repo,
                "default": True,
                "file": Path(DEFAULT_GEOJSON_PATH).name,
            }
        }
        self._restore()
        # Sync default village and any restored villages to SQLite
        try:
            _sync_village_to_sqlite(
                self._db_path,
                self.default_slug,
                default_name,
                default_repo,
                Path(DEFAULT_GEOJSON_PATH).name,
            )
        except Exception as exc:
            logger.warning("Initial SQLite sync for default village skipped: %s", exc)

    # -- queries ------------------------------------------------------------
    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {"slug": s, "name": v["name"]}
                for s, v in self._villages.items()
            ]

    def get(self, slug: str) -> SurveyRepository | None:
        with self._lock:
            entry = self._villages.get(slug)
        return entry["repo"] if entry else None

    def name_of(self, slug: str) -> str | None:
        with self._lock:
            entry = self._villages.get(slug)
        return entry["name"] if entry else None

    # -- add ----------------------------------------------------------------
    def add(self, name: str, geojson_text: str) -> dict[str, Any]:
        name = " ".join(str(name or "").split())
        if not name:
            raise ValueError("Enter a village name.")
        if len(name) > MAX_NAME_LEN:
            raise ValueError(f"Village name is too long (max {MAX_NAME_LEN} characters).")
        slug = _slugify(name)
        try:
            parsed = json.loads(geojson_text)
        except ValueError as exc:
            raise ValueError(f"That file is not valid JSON/GeoJSON ({exc}).") from None
        if not isinstance(parsed, dict) or parsed.get("type") != "FeatureCollection":
            raise ValueError("GeoJSON root must be a FeatureCollection of survey polygons.")

        with self._lock:
            if slug in self._villages:
                raise FileExistsError(f"A village named '{self._villages[slug]['name']}' already exists.")
            self._dir.mkdir(parents=True, exist_ok=True)
            filename = f"{slug}.geojson"
            path = self._dir / filename
            path.write_text(geojson_text, encoding="utf-8")
            repository = GeoJSONSurveyRepository(path)
            try:
                repository.get_polygons_payload()  # full validation (CRS, geometry, survey numbers)
            except (ValueError, FileNotFoundError):
                path.unlink(missing_ok=True)
                raise
            self._villages[slug] = {"name": name, "repo": repository, "file": filename}
            self._save()
            # Also persist directly into SQLite table
            _sync_village_to_sqlite(self._db_path, slug, name, repository, filename)

        return {"slug": slug, "name": name, "count": repository.count()}

    # -- persistence --------------------------------------------------------
    def _save(self) -> None:
        rows = [
            {"slug": s, "name": v["name"], "file": v["file"]}
            for s, v in self._villages.items()
            if not v.get("default")
        ]
        tmp = self._index_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self._index_file)

    def _restore(self) -> None:
        if not self._index_file.is_file():
            return
        try:
            rows = json.loads(self._index_file.read_text(encoding="utf-8"))
        except ValueError as exc:
            logger.warning("Could not read %s: %s", self._index_file, exc)
            return
        for row in rows if isinstance(rows, list) else []:
            try:
                slug, name, filename = row["slug"], row["name"], row["file"]
            except (KeyError, TypeError):
                logger.warning("Ignoring malformed village entry: %r", row)
                continue
            path = self._dir / Path(filename).name  # never leave the villages folder
            if slug in self._villages or not path.is_file():
                logger.warning("Skipping village '%s' (duplicate or file missing: %s)", slug, path)
                continue
            repo = GeoJSONSurveyRepository(path)
            self._villages[slug] = {"name": name, "repo": repo, "file": path.name}
            # Sync restored village into SQLite as well
            try:
                _sync_village_to_sqlite(self._db_path, slug, name, repo, path.name)
            except Exception as exc:
                logger.warning("Could not sync restored village '%s' to SQLite: %s", name, exc)


# =========================================================================== #
# Front end (single page, Leaflet from CDN)
# =========================================================================== #
PAGE_HTML = r'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Land Records GIS</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css">
<style>
*{box-sizing:border-box}
html,body{height:100%;margin:0;font-family:ui-sans-serif,system-ui,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:#f1f5f9}
.app{display:flex;height:100%}
aside{width:380px;flex-shrink:0;background:#fff;border-right:1px solid #e2e8f0;padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:18px}
h1{font-size:18px;margin:0;font-weight:600}.sub{margin:2px 0 0;font-size:14px;color:#64748b}
label{display:block;font-size:14px;font-weight:500;color:#334155;margin-bottom:6px}
.row{display:flex;gap:8px}
input[type=search],input[type=text],select{flex:1;min-width:0;padding:9px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;font-variant-numeric:tabular-nums}
input[type=search]:focus,input[type=text]:focus,select:focus{border-color:#047857;box-shadow:0 0 0 3px #a7f3d0}
input.bad{border-color:#f87171}
[hidden]{display:none!important}
select{width:100%;background:#fff}
.village{display:flex;flex-direction:column;gap:8px;padding-bottom:16px;border-bottom:1px solid #e2e8f0}
.village .ghost{margin-top:0}
.choices{display:flex;flex-direction:column;gap:6px;margin-top:8px}.choices .ghost{margin-top:0;text-align:left}
#addForm{display:flex;flex-direction:column;gap:8px;border:1px dashed #cbd5e1;background:#f8fafc;border-radius:8px;padding:12px}
#addForm input[type=file]{font-size:13px;max-width:100%}
.hint{font-size:12px;color:#64748b;line-height:1.4}
#addMsg{font-size:13px;color:#475569}#addMsg.bad{color:#b91c1c}
button{font:inherit;font-size:14px;cursor:pointer;border-radius:8px;padding:9px 16px}
.primary{background:#047857;color:#fff;border:0;font-weight:600}.primary:hover{background:#065f46}
.ghost{width:100%;margin-top:8px;background:#fff;border:1px solid #cbd5e1;color:#334155;font-weight:500}.ghost:hover{background:#f8fafc}
button:disabled{opacity:.5;cursor:not-allowed}
#err{display:none;margin-top:8px;padding:9px 12px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;font-size:14px}
#err b{display:block}#err span{color:#b91c1c}
.card{border:1px solid #fecaca;background:#fef2f20d;border-radius:8px;padding:16px}
.card h2{margin:0;font-size:14px;font-weight:500;color:#475569}
.big{font-size:38px;font-weight:600;color:#b91c1c;margin:4px 0 8px;font-variant-numeric:tabular-nums}
.empty{border:1px dashed #cbd5e1;background:#f8fafc;border-radius:8px;padding:18px;font-size:14px;color:#475569}
.empty b{display:block;color:#1e293b;margin-bottom:4px}
dl{margin:0}.r{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-top:1px solid #fee2e2;font-size:14px}
.r:first-child{border-top:0}.r dt{color:#64748b}.r dd{margin:0;text-align:right;font-weight:500;font-variant-numeric:tabular-nums}
.r small{display:block;font-size:12px;font-weight:400;color:#64748b}.none{font-style:italic;font-weight:400!important;color:#94a3b8}
.extra{border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-top:16px}.extra h3{margin:0 0 4px;font-size:14px;color:#334155}.extra .r{border-color:#f1f5f9}
main{flex:1;position:relative;min-width:0}#map{position:absolute;inset:0}
.legend{position:absolute;left:12px;top:12px;z-index:1000;background:#ffffffe6;padding:8px 12px;border-radius:8px;font-size:12px;box-shadow:0 2px 8px #0003;pointer-events:none}
.legend div{display:flex;align-items:center;gap:8px;margin:3px 0}.legend i{width:16px;height:12px;border-radius:2px;display:inline-block}
#status{position:absolute;inset:0;z-index:1100;background:#ffffffb3;display:flex;align-items:center;justify-content:center}
#status div{background:#fff;padding:12px 18px;border-radius:8px;box-shadow:0 4px 16px #0003;font-size:14px;max-width:340px}
.leaflet-overlay-pane path.leaflet-interactive{transition:fill .25s ease,fill-opacity .25s ease,stroke .25s ease,stroke-width .25s ease}
@keyframes pulse{0%{stroke-width:10px;fill-opacity:.95}100%{stroke-width:4px;fill-opacity:.55}}
.leaflet-overlay-pane path.pulse{animation:pulse .9s ease-out}
.lbl{pointer-events:none}.lbl span{position:absolute;transform:translate(-50%,-50%);white-space:nowrap;font:600 11px/1 ui-sans-serif,system-ui,sans-serif;color:#0f172a;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 2px #fff}
.leaflet-container:not(.labels) .lbl{display:none}
.pp .leaflet-popup-content-wrapper{padding:0;overflow:hidden;border-radius:12px}.pp .leaflet-popup-content{margin:0;min-width:230px}
.pp a.leaflet-popup-close-button{color:#cbd5e1;top:6px;right:8px}
.pp .hd{background:#0f172a;color:#fff;padding:10px 40px 10px 14px;font-size:13px;font-weight:600}
.pp dl{padding:4px 14px 8px}.pp .r{border-color:#e2e8f0;padding:7px 0;font-size:13px}.pp .r dd.s{font-size:15px;font-weight:700;color:#b91c1c}
@media (max-width:760px){.app{flex-direction:column}aside{width:100%;max-height:55%}main{min-height:300px}}
@media (prefers-reduced-motion:reduce){.leaflet-overlay-pane path.leaflet-interactive{transition:none}.leaflet-overlay-pane path.pulse{animation:none}}
</style>
</head>
<body>
<div class="app">
  <aside>
    <header><h1 id="title">Land records</h1><p class="sub" id="count">Survey parcel map</p></header>
    <section class="village">
      <button type="button" class="ghost" id="toggleAdd">+ Add village</button>
      <form id="addForm" autocomplete="off" hidden>
        <input id="vName" type="text" placeholder="Village name" maxlength="60" required>
        <input id="vFile" type="file" accept=".geojson,.json,application/geo+json,application/json" required>
        <div class="hint">Survey-polygon GeoJSON (EPSG:4326 or EPSG:3857) with a <code>survey no</code> property on each parcel. It will appear on this same map.</div>
        <button type="submit" class="primary" id="vSave">Upload &amp; add to map</button>
        <div id="addMsg" role="status"></div>
      </form>
    </section>
    <form id="form" autocomplete="off">
      <label for="q">Find a survey number</label>
      <div class="row"><input id="q" type="search" list="surveys" placeholder="e.g. 105" disabled><button class="primary" id="go" disabled>Search</button></div>
      <datalist id="surveys"></datalist>
      <div id="err" role="alert"><b></b><span></span></div>
      <button type="button" class="ghost" id="reset" disabled>Reset map</button>
    </form>
    <section id="side" aria-live="polite"></section>
  </aside>
  <main><div id="map"></div>
    <div class="legend"><div><i style="background:#d1d5db;border:1px solid #000"></i>Parcel</div><div><i style="background:#fcd34d;border:2px solid #000"></i>Hover</div><div><i style="background:#dc2626;border:3px solid #7f1d1d"></i>Selected</div></div>
    <div id="status"><div>Loading survey boundaries…</div></div>
  </main>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<script>
(() => {
  const BASE = {color:'#000000', weight:1, opacity:1, fillColor:'#d1d5db', fillOpacity:.55};
  const STYLE = {base:BASE, hover:{...BASE, weight:2.5, fillColor:'#fcd34d', fillOpacity:.7},
                 selected:{...BASE, color:'#7f1d1d', weight:4, fillColor:'#dc2626', fillOpacity:.55}};
  const FIT = {padding:[48,48], maxZoom:18, animate:true, duration:.9};
  const $ = id => document.getElementById(id);
  const norm = v => { const t = String(v ?? '').trim().replace(/\s+/g,' '); return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/,'') : t; };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nf = new Intl.NumberFormat('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const area = s => ({p:`${nf.format(s)} m²`, s:`${(s/1e4).toFixed(3)} ha · ${(s/4046.8564224).toFixed(2)} ac`});
  const owner = o => (typeof o==='string' && o.trim()) ? {t:o.trim(), ok:true} : {t:'Not recorded', ok:false};
  const getJson = url => fetch(url).then(r => { if (!r.ok) throw new Error(`Server returned ${r.status}`); return r.json(); });

  const map = L.map('map',{zoomControl:false, zoomSnap:.25, maxZoom:20, minZoom:11}).setView([12.0037,78.512],14);
  const street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,maxNativeZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20,maxNativeZoom:18,attribution:'Tiles &copy; Esri'});
  L.control.zoom({position:'topright'}).addTo(map);
  L.control.layers({Street:street, Satellite:sat},null,{position:'topright'}).addTo(map);
  L.control.scale({position:'bottomleft',imperial:false}).addTo(map);
  const syncLabels = () => map.getContainer().classList.toggle('labels', map.getZoom() >= 15);
  map.on('zoomend', syncLabels);

  // All villages live together on this one map.
  const all = L.featureGroup().addTo(map), labels = L.layerGroup().addTo(map);
  const layers = new Map();   // unique key "slug|survey" -> leaflet layer
  const index = new Map();    // normalised survey no -> [features]  (same number may exist in several villages)
  let villages = [], failed = [], selectedKey = null, hovered = null, home = null;

  const restyle = l => { const k = l.feature.properties._key;
    l.setStyle(k === selectedKey ? STYLE.selected : l === hovered ? STYLE.hover : STYLE.base); };

  function renderSide(f) {
    const side = $('side');
    if (!f) { side.innerHTML = '<div class="empty"><b>No survey selected</b>Search a survey number above, or click any parcel on the map.</div>'; return; }
    const p = f.properties, a = area(p.area_sqm), o = owner(p.owner);
    const fields = [['Village','village'],['Taluk','taluk'],['District','district'],['Patta number','patta_no'],['Sub-division','subdivision'],['Extent','extent'],['Classification','classification']]
      .filter(([,k]) => p[k] != null && String(p[k]).trim() !== '');
    side.innerHTML = `<div class="card"><h2>Selected survey</h2><div class="big">${esc(p.survey_no)}</div><dl>
      <div class="r"><dt>Survey no.</dt><dd>${esc(p.survey_no)}</dd></div>
      <div class="r"><dt>Village</dt><dd>${esc(p.village)}</dd></div>
      <div class="r"><dt>Area</dt><dd>${esc(a.p)}<small>${esc(a.s)}</small></dd></div>
      <div class="r"><dt>Owner</dt><dd class="${o.ok?'':'none'}">${esc(o.t)}</dd></div>
      <div class="r"><dt>Latitude</dt><dd>${p.centroid_lat.toFixed(6)}</dd></div>
      <div class="r"><dt>Longitude</dt><dd>${p.centroid_lng.toFixed(6)}</dd></div></dl></div>` +
      (fields.length ? `<div class="extra"><h3>Land records</h3><dl>${fields.map(([l,k]) => `<div class="r"><dt>${l}</dt><dd>${esc(p[k])}</dd></div>`).join('')}</dl></div>` : '');
  }
  function renderChoices(key, matches) {
    const side = $('side');
    side.innerHTML = `<div class="empty"><b>Survey ${esc(key)} exists in ${matches.length} villages</b>Choose which one to show:</div>
      <div class="choices">${matches.map((f,i) => `<button type="button" class="ghost" data-i="${i}">${esc(f.properties.village)}</button>`).join('')}</div>`;
    side.querySelectorAll('button').forEach(b => b.onclick = () => { clearError(); select(matches[+b.dataset.i], true); });
  }
  function popupHtml(f) {
    const p = f.properties, a = area(p.area_sqm), o = owner(p.owner);
    return `<div class="hd">Land parcel</div><dl>
      <div class="r"><dt>Survey number</dt><dd class="s">${esc(p.survey_no)}</dd></div>
      <div class="r"><dt>Village</dt><dd>${esc(p.village)}</dd></div>
      <div class="r"><dt>Area</dt><dd>${esc(a.p)}<small>${esc(a.s)}</small></dd></div>
      <div class="r"><dt>Owner</dt><dd class="${o.ok?'':'none'}">${esc(o.t)}</dd></div></dl>`;
  }
  function showError(title, detail) {
    const e = $('err'); e.querySelector('b').textContent = title; e.querySelector('span').textContent = detail || '';
    e.style.display = 'block'; $('q').classList.add('bad');
  }
  function clearError() { $('err').style.display = 'none'; $('q').classList.remove('bad'); }

  function select(feature, zoom) {
    const prev = selectedKey; selectedKey = feature ? feature.properties._key : null;
    if (prev && prev !== selectedKey && layers.get(prev)) restyle(layers.get(prev));
    renderSide(feature);
    if (!feature) return;
    const l = layers.get(selectedKey); restyle(l); l.bringToFront();
    const el = l.getElement(); if (el) { el.classList.remove('pulse'); void el.getBoundingClientRect(); el.classList.add('pulse'); }
    if (zoom) { map.closePopup(); map.fitBounds(l.getBounds(), FIT); }
  }

  function search(raw) {
    const key = norm(raw);
    if (!key) return showError('Enter a survey number', 'Type a number such as 105 and press Search.');
    const matches = index.get(key) || [];          // in-memory lookup across every village on the map
    if (!matches.length) return showError('Survey Not Found', `No parcel with survey number ${key} exists in the loaded villages.`);
    clearError();
    if (matches.length === 1) return select(matches[0], true);
    select(null, false); renderChoices(key, matches);  // same number in several villages -> let the user pick
  }
  function reset() {
    $('q').value = ''; clearError(); select(null, false); map.closePopup();
    if (home) map.fitBounds(home, {...FIT, padding:[24,24]});
  }

  $('form').addEventListener('submit', e => { e.preventDefault(); search($('q').value); });
  $('q').addEventListener('input', clearError);
  $('reset').addEventListener('click', reset);
  renderSide(null);

  // ---- adding one village's polygons to the shared map ----------------------
  function addVillageLayer(v, data) {
    const group = L.geoJSON(data, {
      style: () => STYLE.base,
      onEachFeature: (f, layer) => {
        const p = f.properties; p._key = `${v.slug}|${p.survey_no}`; p.village = v.name;
        layers.set(p._key, layer);
        const k = norm(p.survey_no); if (!index.has(k)) index.set(k, []); index.get(k).push(f);
        layer.on({
          mouseover: () => { hovered = layer; restyle(layer); layer.bringToFront(); },
          mouseout: () => { if (hovered === layer) hovered = null; restyle(layer); if (selectedKey && layers.get(selectedKey)) layers.get(selectedKey).bringToFront(); },
          click: e => { L.DomEvent.stopPropagation(e); $('q').value = p.survey_no; clearError(); select(f, false); layer.openPopup(e.latlng); }
        });
        layer.bindPopup(() => popupHtml(f), {className:'pp', maxWidth:300, autoPanPadding:[24,24]});
        L.marker([p.centroid_lat, p.centroid_lng], {interactive:false, keyboard:false,
          icon:L.divIcon({className:'lbl', html:`<span>${esc(p.survey_no)}</span>`, iconSize:[0,0]})}).addTo(labels);
      }
    });
    group.addTo(all);
    return group;
  }
  const loadVillage = v => getJson(`/gis/villages/${encodeURIComponent(v.slug)}/polygons`).then(data => addVillageLayer(v, data));

  function refreshUi() {
    home = all.getBounds();
    $('surveys').innerHTML = [...index.keys()].sort((a,b) => a.localeCompare(b,undefined,{numeric:true})).map(n => `<option value="${esc(n)}">`).join('');
    const loaded = villages.filter(v => !failed.includes(v));
    $('title').textContent = loaded.length === 1 ? `${loaded[0].name} land records` : 'Land records';
    document.title = loaded.length === 1 ? `${loaded[0].name} · Land Records GIS` : 'Land Records GIS';
    $('count').textContent = `${layers.size} survey parcels` + (loaded.length > 1 ? ` · ${loaded.length} villages` : '') +
      (failed.length ? ` · could not load: ${failed.map(v => v.name).join(', ')}` : '');
    ['q','go','reset'].forEach(id => $(id).disabled = false);
    $('status').style.display = 'none'; syncLabels();
  }

  function loadAll() {
    $('status').style.display = 'flex'; $('status').innerHTML = '<div>Loading survey boundaries…</div>';
    all.clearLayers(); labels.clearLayers(); layers.clear(); index.clear(); failed = []; selectedKey = hovered = null;
    getJson('/gis/villages')
      .then(list => { villages = list; return Promise.allSettled(list.map(loadVillage)); })
      .then(results => {
        failed = villages.filter((v, i) => results[i].status === 'rejected');
        if (failed.length === villages.length) throw results[0].reason;
        refreshUi(); map.fitBounds(home, {padding:[24,24], animate:false});
      })
      .catch(err => {
        $('status').innerHTML = `<div><b style="color:#991b1b">Could not load the survey layer</b><p>${esc(err.message)}</p><button class="primary" id="retry">Try again</button></div>`;
        $('retry').onclick = loadAll;
      });
  }

  // ---- "+ Add village" --------------------------------------------------------
  const addMsg = (t, bad) => { const m = $('addMsg'); m.textContent = t || ''; m.classList.toggle('bad', !!bad); };
  $('toggleAdd').addEventListener('click', () => {
    const f = $('addForm'); f.hidden = !f.hidden; addMsg('');
    $('toggleAdd').textContent = f.hidden ? '+ Add village' : 'Cancel';
    if (!f.hidden) $('vName').focus();
  });
  $('addForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('vName').value.trim(), file = $('vFile').files[0];
    if (!name || !file) return addMsg('Enter a name and choose a GeoJSON file.', true);
    $('vSave').disabled = true; addMsg('Uploading and checking the file…');
    try {
      const geojson = await file.text();
      const r = await fetch('/gis/villages', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, geojson})});
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail ? String(body.detail) : `Server returned ${r.status}`);
      const v = {slug: body.slug, name: body.name};
      const group = await loadVillage(v);              // drawn on the SAME map, next to the existing villages
      villages.push(v); refreshUi();
      map.fitBounds(group.getBounds(), FIT);
      e.target.reset(); e.target.hidden = true; $('toggleAdd').textContent = '+ Add village'; addMsg('');
    } catch (err) { addMsg(err.message, true); }
    finally { $('vSave').disabled = false; }
  });

  loadAll();
})();
</script>
</body>
</html>
'''


# =========================================================================== #
# API
# =========================================================================== #
try:
    import uvicorn
    from fastapi import FastAPI, HTTPException, Path as ApiPath, Request, Response
    from fastapi.middleware.gzip import GZipMiddleware
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import HTMLResponse, JSONResponse
except ImportError:  # pragma: no cover
    sys.exit('Missing packages. Run:  pip install fastapi "uvicorn[standard]"')

GEOJSON_MEDIA_TYPE = "application/geo+json"
_DEFAULT_PATH = os.getenv("GIS_GEOJSON_PATH", str(DEFAULT_GEOJSON_PATH))
repo: SurveyRepository = GeoJSONSurveyRepository(_DEFAULT_PATH)  # the default village (unchanged behaviour)
registry = VillageRegistry(repo, _default_village_name(_DEFAULT_PATH))

@asynccontextmanager
async def lifespan(_: FastAPI):
    repo.get_polygons_payload()  # load the file once; fail fast if it is missing/broken
    yield


app = FastAPI(title="Digital Land Records GIS", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def index() -> str:
    return PAGE_HTML


def _polygons_response(request: Request, repository: SurveyRepository) -> Response:
    payload = repository.get_polygons_payload()
    headers = {"ETag": payload.etag, "Cache-Control": "public, max-age=300"}
    if request.headers.get("if-none-match", "").strip() == payload.etag:
        return Response(status_code=304, headers=headers)
    return Response(content=payload.body, media_type=GEOJSON_MEDIA_TYPE, headers=headers)


def _search_response(repository: SurveyRepository, survey_no: str) -> JSONResponse:
    feature = repository.get_by_survey_no(survey_no)
    if feature is None:
        raise HTTPException(status_code=404, detail="Survey Not Found")
    return JSONResponse(feature, media_type=GEOJSON_MEDIA_TYPE)


def _village_repo(slug: str) -> SurveyRepository:
    repository = registry.get(slug)
    if repository is None:
        raise HTTPException(status_code=404, detail="Village Not Found")
    return repository


# ---- default village (original endpoints, unchanged) ----------------------
@app.get("/gis/polygons", summary="All survey polygons (WGS84 FeatureCollection)", response_class=Response)
def get_polygons(request: Request) -> Response:
    return _polygons_response(request, repo)


@app.get("/gis/search/{survey_no:path}", summary="Polygon of a single survey number")
def search_survey(survey_no: str = ApiPath(..., min_length=1, max_length=50)) -> JSONResponse:
    return _search_response(repo, survey_no)


# ---- multi-village endpoints ----------------------------------------------
@app.get("/gis/villages", summary="List all villages")
def list_villages() -> JSONResponse:
    return JSONResponse(registry.list())


@app.post("/gis/villages", summary="Add a village from a survey GeoJSON", status_code=201)
async def add_village(request: Request) -> JSONResponse:
    if int(request.headers.get("content-length") or 0) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is too large (limit 60 MB).")
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="Request body must be JSON.") from None
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object.")
    geojson = body.get("geojson")
    if isinstance(geojson, dict):  # API clients may send the object itself
        geojson = json.dumps(geojson)
    if not isinstance(geojson, str) or not geojson.strip():
        raise HTTPException(status_code=400, detail="Missing 'geojson' content.")
    try:
        created = registry.add(body.get("name", ""), geojson)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return JSONResponse(created, status_code=201)


@app.get("/gis/villages/{slug}/polygons", summary="All survey polygons of one village", response_class=Response)
def get_village_polygons(request: Request, slug: str) -> Response:
    return _polygons_response(request, _village_repo(slug))


@app.get("/gis/villages/{slug}/search/{survey_no:path}", summary="Polygon of a survey number in one village")
def search_village_survey(slug: str, survey_no: str = ApiPath(..., min_length=1, max_length=50)) -> JSONResponse:
    return _search_response(_village_repo(slug), survey_no)


# =========================================================================== #
# Launcher
# =========================================================================== #
def main() -> None:
    global repo, registry
    env_port = int(os.getenv("PORT", "8002"))
    env_host = os.getenv("HOST", "127.0.0.1")
    parser = argparse.ArgumentParser(description="Run the Land Records GIS module")
    parser.add_argument("--host", default=env_host)
    parser.add_argument("--port", type=int, default=env_port)
    parser.add_argument("--geojson", help="path to the survey GeoJSON (default: next to this file)")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if args.geojson:
        repo = GeoJSONSurveyRepository(args.geojson)
        registry = VillageRegistry(repo, _default_village_name(args.geojson))
    try:
        repo.get_polygons_payload()
    except (FileNotFoundError, ValueError) as exc:
        sys.exit(f"ERROR: {exc}\nPlace kudumiyampatty_surveys.geojson next to run_gis.py or pass --geojson.")

    url = f"http://{'localhost' if args.host in ('127.0.0.1', '0.0.0.0') else args.host}:{args.port}"
    print(f"\n  GIS portal ready ->  {url}   ({repo.count()} parcels, {len(registry.list())} village(s))\n  Press Ctrl+C to stop.\n")
    if not args.no_browser and not os.getenv("PORT"):
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
