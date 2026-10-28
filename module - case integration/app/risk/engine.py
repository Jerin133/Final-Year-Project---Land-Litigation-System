"""
Litigation risk engine: trains on the cases Module 2 extracted from the PDFs
and predicts, for every case,

  * probability of prolonged litigation
  * probability of appeal
  * expected completion time (median + 80% range)
  * a 0-100 risk score

Two real statistical models are fitted from the data each time the engine is
(re)trained - nothing is hard-coded or mocked:

  1. Weibull AFT survival model (survival.py)  -> duration / prolonged / completion
     Open cases enter as right-censored observations, so they are used
     correctly instead of being dropped or treated as "finished today".
  2. Ridge-regularised logistic regression      -> appeal probability

Because the data set is small, regularisation strength is chosen by
cross-validation and may shrink the model to "just the base rate" when the
data holds no usable signal.  Cross-validated quality (C-index, AUC) is
reported in model_info() so you can see how far to trust the numbers.

The risk score is a transparent weighted blend (weights/horizon below) -
there is no ground-truth "risk" label to learn it from.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timedelta, timezone

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict

from .features import FeatureSpace, as_of_date, build_rows, human_label
from .land_features import get_land_features
from .survival import WeibullAFT, concordance, cross_validate

log = logging.getLogger(__name__)


def _env_float(name, default):
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return float(default)


PROLONGED_DAYS = _env_float("RISK_PROLONGED_DAYS", 1095)     # "prolonged" = total duration longer than this (3 years)
HORIZON_DAYS = _env_float("RISK_HORIZON_DAYS", 1825)         # time-scale (5 years) of the delay component
MAX_YEARS = _env_float("RISK_MAX_YEARS", 10)                 # completion estimates are capped at this many years from today
W_PROLONGED = _env_float("RISK_W_PROLONGED", 0.40)
W_APPEAL = _env_float("RISK_W_APPEAL", 0.30)
W_DELAY = _env_float("RISK_W_DELAY", 0.30)
BAND_MEDIUM = _env_float("RISK_BAND_MEDIUM", 35)
BAND_HIGH = _env_float("RISK_BAND_HIGH", 65)
FUTURE_DISPOSAL_POLICY = os.environ.get("RISK_FUTURE_DISPOSAL_POLICY", "censor")  # censor | exclude
MIN_EVENTS = 12      # fewer disposals than this -> no covariates in the duration model
MIN_PER_CLASS = 8    # fewer appeals / non-appeals than this -> appeal model = base rate
RIDGE_GRID = [0.5, 2.0, 8.0, 32.0, 128.0, 512.0, 2048.0]
# hearings_per_year = hearings / case age, and case age IS the time axis of the survival model:
# using it there would leak the outcome into the inputs (short observed time -> high rate).
DURATION_EXCLUDE = {"hearings_per_year"}


def _quality(value, weak, good):
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "unknown"
    return "weak" if value < weak else ("good" if value >= good else "moderate")


class RiskEngine:
    def __init__(self):
        self._lock = threading.Lock()
        self.ready = False
        self.error = None
        self.predictions = {}
        self.info = {}

    # ------------------------------------------------------------------ fit
    def fit(self, records):
        with self._lock:
            try:
                self._fit(records)
                self.ready, self.error = True, None
            except Exception as e:                                   # keep the main app alive
                log.exception("risk engine training failed")
                self.ready, self.error = False, f"{type(e).__name__}: {e}"

    def _fit(self, records):
        as_of = as_of_date()
        rows = build_rows(records, as_of, land_fn=get_land_features,
                          future_disposal_policy=FUTURE_DISPOSAL_POLICY)
        if len(rows) < 10:
            raise ValueError(f"only {len(rows)} case(s) available - need at least 10 to train")

        fs = FeatureSpace().fit(rows)
        X_all = fs.transform(rows)
        cols = fs.columns
        warnings = []

        # ---------------- duration / survival model ----------------------
        tr = [i for i, r in enumerate(rows) if r.duration_days is not None]
        t = np.array([rows[i].duration_days for i in tr], float)
        ev = np.array([rows[i].event for i in tr], int)
        n_events = int(ev.sum())
        Xd = X_all[tr]
        if n_events < MIN_EVENTS:
            warnings.append(f"Only {n_events} completed cases - duration model uses no case features "
                            f"(population-level estimate only).")
            dur_cols = []
        else:
            dur_cols = [j for j, c in enumerate(cols) if c not in DURATION_EXCLUDE]
        Xd_use = Xd[:, dur_cols] if dur_cols else np.zeros((len(tr), 0))

        if dur_cols:
            best = None
            for lam in RIDGE_GRID:
                _, ll = cross_validate(Xd_use, t, ev, lam)
                if best is None or ll > best[1]:
                    best = (lam, ll)
            ridge = best[0]
            oof_mu, _ = cross_validate(Xd_use, t, ev, ridge)
            c_index = concordance(oof_mu, t, ev)
        else:
            ridge, c_index = RIDGE_GRID[-1], float("nan")
        aft = WeibullAFT(ridge).fit(Xd_use, t, ev)

        # ---------------- appeal model ------------------------------------
        a_idx = [i for i, r in enumerate(rows) if r.appeal is not None and r.age_days is not None]
        y = np.array([rows[i].appeal for i in a_idx], int)
        appeal_cols = [j for j, c in enumerate(cols) if c != "appeal_filed"]
        age_years = np.array([rows[i].age_days / 365.25 for i in a_idx])[:, None]
        Xa = np.hstack([X_all[a_idx][:, appeal_cols], age_years])
        a_names = [cols[j] for j in appeal_cols] + ["case_age_years"]
        a_mean = Xa.mean(axis=0)
        a_std = np.where(Xa.std(axis=0) < 1e-9, 1.0, Xa.std(axis=0))
        Za = (Xa - a_mean) / a_std
        pos, neg = int(y.sum()), int((1 - y).sum())
        base_rate = float(y.mean()) if len(y) else 0.0
        appeal_auc = appeal_skill = None
        logit = None
        if pos >= MIN_PER_CLASS and neg >= MIN_PER_CLASS:
            folds = min(5, pos, neg)
            skf = StratifiedKFold(folds, shuffle=True, random_state=0)
            best = None
            for C in np.logspace(-3, 1, 9):
                oof_c = cross_val_predict(LogisticRegression(C=C, max_iter=2000), Za, y, cv=skf,
                                          method="predict_proba")[:, 1]
                ll = log_loss(y, oof_c)
                if best is None or ll < best[1]:
                    best = (float(C), ll, oof_c)
            C, _, oof = best
            logit = LogisticRegression(C=C, max_iter=2000).fit(Za, y)
            appeal_auc = float(roc_auc_score(y, oof))
            b_model = brier_score_loss(y, oof)
            b_base = brier_score_loss(y, np.full(len(y), base_rate))
            appeal_skill = float(1 - b_model / b_base) if b_base > 0 else 0.0
        else:
            warnings.append(f"Only {pos} appeal / {neg} non-appeal cases - appeal probability is the "
                            f"overall base rate for every case.")

        # ---------------- predictions -------------------------------------
        self._max_obs = float(t.max()) if len(t) else 0.0
        self._binary = set(fs.binary_cols)
        preds = {}
        for i, r in enumerate(rows):
            preds[r.case_id] = self._predict_row(
                i, r, rows, X_all, cols, dur_cols, aft, logit, a_names, appeal_cols,
                a_mean, a_std, base_rate, as_of)

        n_closed_known = sum(1 for r in rows if r.event == 1)
        scored = sorted(p["risk_score"] for p in preds.values() if p.get("risk_score") is not None)
        for p in preds.values():
            if p.get("risk_score") is not None and len(scored) > 1:
                below = sum(1 for v in scored if v < p["risk_score"])
                p["risk_percentile_among_open_cases"] = round(100.0 * below / (len(scored) - 1), 0)
        dq = {
            "future_disposal_dates": sum(1 for r in rows if any("in the future" in f for f in r.flags)),
            "disposed_without_date": sum(1 for r in rows if any("no disposal_date" in f for f in r.flags)),
            "missing_filing_date": sum(1 for r in rows if any("filing_date missing" in f for f in r.flags)),
        }
        if dq["future_disposal_dates"]:
            warnings.append(
                f"{dq['future_disposal_dates']} case(s) have a disposal date later than today "
                f"({as_of.isoformat()}); policy '{FUTURE_DISPOSAL_POLICY}' treats them as not yet "
                f"completed. Check the source documents.")
        if _quality(c_index, 0.60, 0.70) == "weak":
            warnings.append("Duration model has weak cross-validated discrimination - completion-time "
                            "estimates are close to population averages.")
        if appeal_auc is not None and _quality(appeal_auc, 0.6, 0.7) == "weak":
            warnings.append("Appeal model has weak cross-validated discrimination - appeal probabilities "
                            "are close to the overall base rate.")

        self.predictions = preds
        self.info = {
            "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "as_of": as_of.isoformat(),
            "cases_total": len(rows),
            "land_features_in_use": [c for c in cols if c.startswith("land_")],
            "duration_model": {
                "type": "Weibull accelerated-failure-time survival model, right-censored, ridge-regularised",
                "cases_used": len(tr), "completed": n_events, "still_open_or_censored": len(tr) - n_events,
                "ridge": ridge, "weibull_shape_sigma": round(aft.sigma, 3),
                "cv_c_index": None if np.isnan(c_index) else round(float(c_index), 3),
                "reliability": _quality(c_index, 0.60, 0.70),
                "features": [cols[j] for j in dur_cols],
                "excluded_to_avoid_leakage": sorted(DURATION_EXCLUDE),
            },
            "appeal_model": {
                "type": "L2 logistic regression" if logit is not None else "base rate only",
                "cases_used": len(y), "appeals": pos, "no_appeal": neg,
                "base_rate": round(base_rate, 3),
                "cv_auc": None if appeal_auc is None else round(appeal_auc, 3),
                "cv_brier_skill_vs_base_rate": None if appeal_skill is None else round(appeal_skill, 3),
                "reliability": _quality(appeal_auc, 0.6, 0.7),
                "features": a_names if logit is not None else [],
            },
            "definitions": {
                "prolonged_litigation": f"total duration longer than {int(PROLONGED_DAYS)} days",
                "risk_score": (f"100 x ({W_PROLONGED}*P(prolonged) + {W_APPEAL}*P(appeal) + "
                               f"{W_DELAY}*(1 - exp(-median remaining days / {int(HORIZON_DAYS)})))"),
                "bands": f"Low < {int(BAND_MEDIUM)} <= Medium < {int(BAND_HIGH)} <= High",
            },
            "data_quality": dq,
            "warnings": warnings,
        }
        self._model_refs = dict(aft=aft, logit=logit, fs=fs)

    # -------------------------------------------------------- one prediction
    def _predict_row(self, i, r, rows, X_all, cols, dur_cols, aft, logit, a_names,
                     appeal_cols, a_mean, a_std, base_rate, as_of):
        out = {
            "case_id": r.case_id, "status": r.status, "closed": bool(r.is_closed),
            "case_age_days": None if r.age_days is None else int(round(r.age_days)),
            "as_of": as_of.isoformat(), "data_quality_flags": list(r.flags),
            "prolonged_threshold_days": int(PROLONGED_DAYS),
        }

        # ---- closed cases: report what actually happened ------------------
        if r.is_closed:
            dur = None
            if r.filing and r.disposal and r.filing <= r.disposal <= as_of:
                dur = (r.disposal - r.filing).days
            out.update({
                "mode": "closed_actual",
                "prolonged_probability": (None if dur is None else float(dur > PROLONGED_DAYS)),
                "appeal_probability": None if r.appeal is None else float(r.appeal),
                "appeal_already_filed": bool(r.appeal) if r.appeal is not None else None,
                "risk_score": None, "risk_band": "Closed",
                "expected_completion": {
                    "actual_disposal_date": r.disposal.isoformat() if r.disposal else None,
                    "actual_duration_days": dur,
                },
                "drivers": {"duration": [], "appeal": []},
            })
            return out

        if r.age_days is None:
            out.update({"mode": "insufficient_data", "risk_band": "Unknown", "risk_score": None,
                        "prolonged_probability": None, "appeal_probability": None,
                        "expected_completion": None, "drivers": {"duration": [], "appeal": []}})
            return out

        # ---- duration model ----------------------------------------------
        x = X_all[i:i + 1]
        xd = x[:, dur_cols] if dur_cols else np.zeros((1, 0))
        age = float(max(r.age_days, 1.0))
        p_prol = float(aft.prob_longer_than(xd, PROLONGED_DAYS, age)[0])
        q10, q50, q90 = (float(aft.remaining_quantile(xd, age, q)[0]) for q in (0.1, 0.5, 0.9))
        cap = MAX_YEARS * 365.25
        capped = q50 > cap
        beyond_observed = (age + q50) > self._max_obs
        q10, q50, q90 = min(q10, cap), min(q50, cap), min(q90, cap)
        d = lambda days: (as_of + timedelta(days=int(round(days)))).isoformat()

        # ---- appeal model ------------------------------------------------
        already = bool(r.appeal) if r.appeal is not None else False
        if logit is not None:
            xa = np.hstack([x[:, appeal_cols], [[age / 365.25]]])
            za = (xa - a_mean) / a_std
            p_app_model = float(logit.predict_proba(za)[0, 1])
        else:
            za, p_app_model = None, base_rate
        p_app = 1.0 if already else p_app_model

        delay_idx = 1.0 - float(np.exp(-q50 / HORIZON_DAYS))     # smooth: 1y~0.18, 5y~0.63, 10y~0.87 (HORIZON=5y)
        score = 100.0 * (W_PROLONGED * p_prol + W_APPEAL * p_app + W_DELAY * delay_idx)
        band = "High" if score >= BAND_HIGH else ("Medium" if score >= BAND_MEDIUM else "Low")

        # ---- drivers -----------------------------------------------------
        drivers = {"duration": [], "appeal": []}
        if dur_cols:
            contrib = aft.contributions(xd[0])
            for j in np.argsort(-np.abs(contrib)):
                col = cols[dur_cols[j]]
                is_flag = "=" in col or col in self._binary
                if is_flag and x[0, dur_cols[j]] < 0.5:        # flag/category the case does not have
                    continue
                if abs(contrib[j]) < 0.03:
                    continue
                pct = (np.exp(contrib[j]) - 1) * 100
                item = {"factor": human_label(col),
                        "effect": "lengthens" if pct > 0 else "shortens",
                        "change_in_expected_duration_pct": round(float(pct), 1)}
                if not is_flag:
                    item["case_vs_typical"] = "higher" if x[0, dur_cols[j]] > aft.mean_[j] else "lower"
                drivers["duration"].append(item)
                if len(drivers["duration"]) == 3:
                    break
        if logit is not None and za is not None:
            contrib = logit.coef_[0] * za[0]
            for j in np.argsort(-np.abs(contrib)):
                col = a_names[j]
                is_flag = "=" in col or col in self._binary
                if is_flag and xa[0, j] < 0.5:                  # flag/category the case does not have
                    continue
                if abs(contrib[j]) < 0.05:
                    continue
                item = {"factor": human_label(col),
                        "effect": "raises" if contrib[j] > 0 else "lowers",
                        "odds_multiplier": round(float(np.exp(contrib[j])), 2)}
                if not is_flag:
                    item["case_vs_typical"] = "higher" if za[0, j] > 0 else "lower"
                drivers["appeal"].append(item)
                if len(drivers["appeal"]) == 3:
                    break

        out.update({
            "mode": "predicted",
            "prolonged_probability": round(p_prol, 4),
            "appeal_probability": round(p_app, 4),
            "appeal_already_filed": already,
            "risk_score": round(score, 1), "risk_band": band,
            "expected_completion": {
                "median_remaining_days": int(round(q50)),
                "median_remaining_months": round(q50 / 30.44, 1),
                "expected_date": d(q50),
                "range_80pct": {"earliest_date": d(q10), "latest_date": d(q90),
                                "earliest_days": int(round(q10)), "latest_days": int(round(q90))},
                "expected_total_duration_days": int(round(age + q50)),
                "capped_at_max_years": bool(capped),
                "beyond_observed_range": bool(beyond_observed),
                "note": ("Estimate is capped at %d years." % MAX_YEARS if capped else
                         "Median completion lies beyond the longest case duration seen in the "
                         "training data - treat as a rough extrapolation." if beyond_observed else None),
            },
            "already_prolonged": bool(age > PROLONGED_DAYS),
            "score_components": {"prolonged": round(p_prol, 4), "appeal": round(p_app, 4),
                                 "delay_index": round(delay_idx, 4)},
            "drivers": drivers,
        })
        return out

    # ---------------------------------------------------------------- query
    def get(self, case_id):
        return self.predictions.get(case_id)

    def all(self):
        return list(self.predictions.values())

    def model_info(self):
        return {"ready": self.ready, "error": self.error, **self.info}