"""
Weibull accelerated-failure-time (AFT) model with right-censoring and ridge
regularisation, fitted with scipy.  No extra dependency beyond scipy.

Why survival analysis and not a plain regressor?
Most cases are still OPEN.  Their true duration is unknown - we only know
"at least N days so far".  A normal regressor either throws them away or
treats N as the final answer; both are badly biased towards short cases.
An AFT model uses open cases correctly as censored observations.

    ln T = b0 + x.b + sigma * eps ,   eps ~ standard minimum-extreme-value
    S(t | x) = exp( -exp( (ln t - mu) / sigma ) ),   mu = b0 + x.b
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import minimize

LN2 = np.log(2.0)


def _unpack(theta, p):
    return theta[0], theta[1:1 + p], theta[1 + p]


def _neg_loglik(theta, X, logt, event, lam):
    n, p = X.shape
    b0, b, log_sigma = _unpack(theta, p)
    sigma = np.exp(log_sigma)
    mu = b0 + X @ b
    z = (logt - mu) / sigma
    ez = np.exp(np.clip(z, -30, 30))
    ll = np.where(event == 1, -log_sigma + z - ez, -ez)
    dll_dz = np.where(event == 1, 1.0 - ez, -ez)
    dll_dmu = dll_dz * (-1.0 / sigma)
    dll_dls = dll_dz * (-z) + np.where(event == 1, -1.0, 0.0)
    loss = -ll.sum() + 0.5 * lam * np.sum(b ** 2)
    grad = np.empty_like(theta)
    grad[0] = -dll_dmu.sum()
    grad[1:1 + p] = -(X.T @ dll_dmu) + lam * b
    grad[1 + p] = -dll_dls.sum()
    return loss, grad


class WeibullAFT:
    def __init__(self, ridge: float = 2.0):
        self.ridge = ridge
        self.mean_ = self.std_ = None
        self.b0 = 0.0
        self.b = None
        self.sigma = 1.0

    # -- fitting ------------------------------------------------------------
    def fit(self, X, t, event):
        X = np.asarray(X, float)
        t = np.maximum(np.asarray(t, float), 1.0)
        event = np.asarray(event, int)
        self.mean_ = X.mean(axis=0)
        std = X.std(axis=0)
        self.std_ = np.where(std < 1e-9, 1.0, std)
        Z = (X - self.mean_) / self.std_
        logt = np.log(t)
        p = Z.shape[1]
        theta0 = np.zeros(2 + p)
        theta0[0] = logt.mean() + 0.5
        theta0[-1] = np.log(max(logt.std(), 0.3))
        res = minimize(_neg_loglik, theta0, args=(Z, logt, event, self.ridge),
                       jac=True, method="L-BFGS-B")
        self.b0, self.b, ls = _unpack(res.x, p)
        self.sigma = float(np.exp(ls))
        self.converged_ = bool(res.success)
        return self

    def _z(self, X):
        return (np.asarray(X, float) - self.mean_) / self.std_

    def mu(self, X):
        return self.b0 + self._z(X) @ self.b

    # -- prediction ---------------------------------------------------------
    def survival(self, X, t):
        """S(t | x) for scalar/array t (days)."""
        mu = self.mu(X)
        z = (np.log(np.maximum(t, 1e-9)) - mu) / self.sigma
        return np.exp(-np.exp(np.clip(z, -30, 30)))

    def prob_longer_than(self, X, threshold_days, age_days):
        """P(T > threshold | T > age).  1.0 if the case already passed it."""
        age = np.maximum(np.asarray(age_days, float), 1.0)
        s_thr = self.survival(X, threshold_days)
        s_age = np.maximum(self.survival(X, age), 1e-12)
        p = np.where(threshold_days <= age, 1.0, s_thr / s_age)
        return np.clip(p, 0.0, 1.0)

    def remaining_quantile(self, X, age_days, q):
        """Days from now until a fraction q of 'similar open cases already this
        old' will have finished (q=0.5 -> median remaining time)."""
        age = np.maximum(np.asarray(age_days, float), 1.0)
        mu = self.mu(X)
        z_age = (np.log(age) - mu) / self.sigma
        z_t = np.log(np.exp(np.clip(z_age, -30, 30)) - np.log(1.0 - q))
        t_total = np.exp(mu + self.sigma * z_t)
        return np.maximum(t_total - age, 1.0)

    def contributions(self, x_row):
        """Per-column effect on ln(T) for one case, relative to an average case."""
        return self.b * ((np.asarray(x_row, float) - self.mean_) / self.std_)


# -- evaluation helpers -----------------------------------------------------
def concordance(pred_mu, t, event):
    """Harrell's C for right-censored data. pred_mu: higher = predicted longer."""
    pred_mu, t, event = map(np.asarray, (pred_mu, t, event))
    ti, tj = t[:, None], t[None, :]
    comparable = (ti < tj) & (event[:, None] == 1)
    conc = comparable & (pred_mu[:, None] < pred_mu[None, :])
    ties = comparable & (pred_mu[:, None] == pred_mu[None, :])
    n = comparable.sum()
    if n == 0:
        return float("nan")
    return float((conc.sum() + 0.5 * ties.sum()) / n)


def heldout_loglik(model, X, t, event):
    mu = model.mu(X)
    logt = np.log(np.maximum(t, 1.0))
    z = (logt - mu) / model.sigma
    ez = np.exp(np.clip(z, -30, 30))
    ll = np.where(np.asarray(event) == 1, -np.log(model.sigma) + z - ez, -ez)
    return float(ll.mean())


def cross_validate(X, t, event, ridge, k=5, seed=0):
    """Out-of-fold mu and mean held-out log-likelihood."""
    X = np.asarray(X, float); t = np.asarray(t, float); event = np.asarray(event, int)
    n = len(t)
    rng = np.random.default_rng(seed)
    # stratify on event so every fold has events
    idx_e = rng.permutation(np.where(event == 1)[0])
    idx_c = rng.permutation(np.where(event == 0)[0])
    folds = [[] for _ in range(k)]
    for i, j in enumerate(idx_e):
        folds[i % k].append(j)
    for i, j in enumerate(idx_c):
        folds[i % k].append(j)
    oof_mu = np.zeros(n)
    lls = []
    for f in folds:
        te = np.array(f, int)
        tr = np.setdiff1d(np.arange(n), te)
        if event[tr].sum() < 3 or len(te) == 0:
            continue
        m = WeibullAFT(ridge).fit(X[tr], t[tr], event[tr])
        oof_mu[te] = m.mu(X[te])
        lls.append(heldout_loglik(m, X[te], t[te], event[te]))
    return oof_mu, (float(np.mean(lls)) if lls else float("-inf"))