"""
Turns CaseRecord objects (Module 2 output) into numeric model inputs.

Design notes
------------
* Everything is derived from fields Module 2 already extracted from the PDFs.
* Features are scale-free where possible.  Raw hearing_count grows with the
  age of a pending case, so using it directly would let "old" masquerade as
  "complicated".  We use hearings per year and adjournments per hearing.
* Land-record columns (keys starting "land_") are discovered dynamically,
  so adding Module 1 data later needs no change here.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

import numpy as np

_DATE_FORMATS = ("%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d.%m.%y")


def parse_date(s) -> Optional[date]:
    if not s:
        return None
    s = str(s).strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def as_of_date() -> date:
    """'Today' for all age calculations.  Override with RISK_AS_OF=YYYY-MM-DD
    to make results reproducible."""
    env = os.environ.get("RISK_AS_OF")
    if env:
        d = parse_date(env)
        if d:
            return d
    return date.today()


def court_level(court: Optional[str]) -> str:
    c = (court or "").lower()
    if "high court" in c:
        return "High Court"
    if "supreme" in c:
        return "Supreme Court"
    if "district court" in c or "principal district" in c:
        return "District Court"
    if "sub court" in c or "subordinate" in c:
        return "Sub Court"
    if "munsif" in c:
        return "Munsif Court"
    if "tribunal" in c or "revenue" in c:
        return "Tribunal/Revenue"
    return "Other"


def _norm_cat(v) -> str:
    v = (str(v) if v is not None else "").strip()
    return re.sub(r"\s+", " ", v) or "Unknown"


@dataclass
class CaseRow:
    """One case, reduced to what the models need."""
    case_id: str
    categorical: dict            # name -> level
    numeric: dict                # name -> float (NaN allowed = missing)
    age_days: Optional[float]    # days from filing to as_of (open) or to disposal (closed)
    status: str = ""
    is_closed: bool = False
    disposal: Optional[date] = None
    filing: Optional[date] = None
    # survival label
    duration_days: Optional[float] = None   # observed time (event or censoring time)
    event: Optional[int] = None             # 1 = disposed within observation, 0 = censored
    appeal: Optional[int] = None            # 1/0
    flags: list = field(default_factory=list)


def build_rows(records, as_of: date, land_fn=None, future_disposal_policy: str = "censor"):
    """Returns list[CaseRow] for every record (rows that cannot be modelled
    carry duration_days=None and an explanatory flag)."""
    # survey-level context, excluding the case itself
    by_survey: dict = {}
    for r in records:
        by_survey.setdefault(str(r.survey_no), []).append(r)

    def is_open(r):
        return "dispos" not in (r.status_en or "").lower()

    rows = []
    for r in records:
        flags = []
        filing = parse_date(r.filing_date)
        disposal = parse_date(r.disposal_date)
        status = r.status_en or ""
        closed = "dispos" in status.lower()

        if filing is None:
            flags.append("filing_date missing/unreadable")
        elif filing > as_of:
            flags.append("filing_date is after the as-of date")
            filing = None

        # --- time axis ---------------------------------------------------
        duration = event = None
        age = None
        if filing is not None:
            if closed and disposal is not None:
                if disposal < filing:
                    flags.append("disposal_date is before filing_date (ignored)")
                    age = float((as_of - filing).days)
                elif disposal > as_of:
                    flags.append("disposal_date is in the future relative to the as-of date")
                    age = float((as_of - filing).days)
                    if future_disposal_policy == "censor":
                        duration, event = max(age, 1.0), 0
                    # 'exclude' -> leave duration None
                else:
                    age = float((disposal - filing).days)
                    duration, event = max(age, 1.0), 1
            elif closed and disposal is None:
                flags.append("status is Disposed but no disposal_date")
                age = float((as_of - filing).days)
            else:
                age = float((as_of - filing).days)
                duration, event = max(age, 1.0), 0

        # --- covariates --------------------------------------------------
        hearings = r.hearing_count
        adj = r.adjournment_count
        years = max((age or 0.0) / 365.25, 0.25) if age is not None else np.nan
        hearings_per_year = (hearings / years) if (hearings is not None and age is not None) else np.nan
        adj_ratio = (adj / max(hearings, 1)) if (adj is not None and hearings is not None) else np.nan

        siblings = [s for s in by_survey.get(str(r.survey_no), []) if s is not r]
        numeric = {
            "hearings_per_year": hearings_per_year,
            "adjournment_ratio": adj_ratio,
            "other_cases_on_survey": float(len(siblings)),
            "other_open_cases_on_survey": float(sum(1 for s in siblings if is_open(s))),
            "appeal_filed": (1.0 if r.appeal_indicator else 0.0) if r.appeal_indicator is not None else np.nan,
        }
        if land_fn is not None:
            try:
                for k, v in (land_fn(r.survey_no, r.subdivision) or {}).items():
                    if str(k).startswith("land_"):
                        numeric[str(k)] = float(v)
            except Exception as e:                       # never let a land lookup break the module
                flags.append(f"land features unavailable: {e}")

        categorical = {
            "dispute_type": _norm_cat(r.dispute_type_en),
            "court_level": court_level(r.court),
            "case_type": _norm_cat(r.case_type),
        }
        rows.append(CaseRow(
            case_id=r.case_id, categorical=categorical, numeric=numeric, age_days=age,
            status=status, is_closed=closed, disposal=disposal, filing=filing,
            duration_days=duration, event=event,
            appeal=(None if r.appeal_indicator is None else int(bool(r.appeal_indicator))),
            flags=flags,
        ))
    return rows


class FeatureSpace:
    """Learns column layout + imputation values from training rows, then
    turns any CaseRow into a vector.  Unseen categories -> all-zero (baseline)."""

    def __init__(self):
        self.num_cols: list = []
        self.cat_levels: dict = {}
        self.medians: dict = {}
        self.binary_cols: set = set()    # numeric columns that only ever hold 0/1
        self.columns: list = []          # final column names
        self.col_kind: list = []         # 'num' | 'cat'

    def fit(self, rows):
        names = []
        for r in rows:
            for k in r.numeric:
                if k not in names:
                    names.append(k)
        self.num_cols = names
        for k in names:
            vals = np.array([r.numeric.get(k, np.nan) for r in rows], dtype=float)
            vals = vals[~np.isnan(vals)]
            self.medians[k] = float(np.median(vals)) if len(vals) else 0.0
            if len(vals) and set(np.unique(vals)).issubset({0.0, 1.0}):
                self.binary_cols.add(k)
        cats = {}
        for r in rows:
            for k, v in r.categorical.items():
                cats.setdefault(k, set()).add(v)
        self.cat_levels = {k: sorted(v) for k, v in cats.items()}
        self.columns = list(self.num_cols)
        self.col_kind = ["num"] * len(self.num_cols)
        for k, lv in self.cat_levels.items():
            for v in lv:
                self.columns.append(f"{k}={v}")
                self.col_kind.append("cat")
        return self

    def transform(self, rows) -> np.ndarray:
        X = np.zeros((len(rows), len(self.columns)))
        idx = {c: i for i, c in enumerate(self.columns)}
        for i, r in enumerate(rows):
            for k in self.num_cols:
                v = r.numeric.get(k, np.nan)
                X[i, idx[k]] = self.medians[k] if (v is None or np.isnan(v)) else v
            for k, v in r.categorical.items():
                j = idx.get(f"{k}={v}")
                if j is not None:
                    X[i, j] = 1.0
        return X


def human_label(col: str) -> str:
    nice = {
        "hearings_per_year": "hearing frequency (hearings per year)",
        "adjournment_ratio": "share of hearings adjourned",
        "other_cases_on_survey": "other cases on the same survey number",
        "other_open_cases_on_survey": "other open cases on the same survey number",
        "appeal_filed": "an appeal has been filed",
        "case_age_years": "how long the case has already been running",
    }
    if col in nice:
        return nice[col]
    if col.startswith("land_"):
        return "land record: " + col[5:].replace("_", " ")
    if "=" in col:
        k, v = col.split("=", 1)
        return {"dispute_type": "dispute type", "court_level": "court", "case_type": "case type"}.get(k, k) + f": {v}"
    return col