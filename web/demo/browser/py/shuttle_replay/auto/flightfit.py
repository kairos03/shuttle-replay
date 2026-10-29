# SPDX-License-Identifier: AGPL-3.0-only
"""Conditional variable-height flight fit for the top-view shuttle DISPLAY reference.

Replaces the fixed-height ray/plane approximation. Inside the calibrated camera segment,
actual TrackNet observations (pixels at actual PTS) are grouped into candidate flights:
runs are split at cuts, long detector gaps and sharp image direction changes (contact
candidates; a contact changes velocity, not position, so the contact observation ends one
piece and starts the next). Each piece is fitted with a 3D ballistic path under gravity and
quadratic air drag (drag constant a fixed prior) through the conditional camera inferred by
``shuttleref.camera_from_floor_h``. Height is a free variable, so depth comes from the
gravity/drag curvature of the observed pixel track; a weak contact-height prior on the
first point regularises it.

Gates (all logged): image RMS and maximum residual, held-out reprojection, non-negative
heights, points in front of the camera, a broad court-surround box, net clearance when the
path crosses the net, and sensitivity to the drag prior. Observations with large
residuals are rejected and act as barriers. A piece that fails is shown as nothing (its
observations count as rejected). Display statuses:

* estimated: model position at an observed frame of an accepted flight;
* interpolated: model position at a detector-null frame inside an accepted flight;
* reference: after a flight's last observation, that observation's model position held
  for at most HOLD_S with its own frame id/PTS (never a future frame).

Everything is a conditional estimate (camera priors, drag prior, contact-height prior);
image residuals do not certify true 3D accuracy. Raw observations are never changed.
"""

from __future__ import annotations

import math

import numpy as np

from .shuttleref import ray_at_height

METHOD = "auto_flight_fit_v1"
G = 9.81  # m/s^2, +z is DOWN in the court frame
DRAG_K = 0.21  # 1/m, quadratic drag prior (typical feather/nylon shuttle), not measured
# Sensitivity range: terminal velocity ~7.4..6.3 m/s (k = g / vt^2), typical shuttles.
DRAG_K_SENSITIVITY = (0.18, 0.25)
CONTACT_HEIGHT_M, CONTACT_HEIGHT_SD_M = 2.0, 2.0  # weak prior on a flight's first point
DT = 1 / 120
MIN_OBS = 6
MAX_GAP_S = 0.3  # a longer detector gap ends a run
TURN_DEG = 60.0  # contact candidate: image direction change over +-2 observations
SECONDARY_TURN_DEG = 35.0
# Pixel gates are in TrackNet heatmap pixels (512 px wide input), scaled to source pixels:
# observations cannot be localised more finely than that grid.
HEATMAP_W = 512
OUTLIER_HM = 6.0
MAX_OUTLIER_FRACTION = 0.25
MAX_RMS_HM = 2.0
MAX_HOLDOUT_RMS_HM = 3.0
SPIKE_HM = 24.0
MIN_HEIGHT_M, MAX_HEIGHT_M = -0.25, 20.0  # small negative tolerance for floor-contact ends
SURROUND = (-4.0, 10.1, -6.0, 19.4)  # broad court-surround plausibility box (x0, x1, y0, y1)
NET_Y_M, NET_MIN_CLEAR_M = 6.7, 1.3
MAX_SENSITIVITY_M = 3.0
# Depth ambiguity: refit with the first point forced to these heights; if such a fit still
# explains the pixels (RMS within MAX_RMS_PX) and moves the path more than this, reject.
AMBIGUITY_OFFSETS_M = (-3.0, -1.5, 1.5, 3.0)  # relative to the fitted start height
MAX_AMBIGUITY_M = 2.0
MIN_TURN_PX = 5.0
# Deterministic independent seeds over depth/height basins (first/last pixel rays), including
# high partial flights; competing good basins that disagree are rejected, not hidden.
START_HEIGHTS_M = (1.0, 2.5, 4.5, 7.0)
END_HEIGHTS_M = (0.5, 2.0, 4.0, 6.5)
# Continuation-aware outlier test: windows of clean neighbours on each side (skipping +-1).
CONT_WIN = 5
CONT_SKIP = 2  # neighbours skipped on each side: blocks of up to 2 * CONT_SKIP + 1 samples
# Contact candidates also need a plausible hitter (pose ground point near the pixel ray).
CONTACT_PLAUSIBLE_M = 2.6
CONTACT_ANCHOR_SD_M = 0.3  # a shared contact keeps position: start of the next flight
MAX_CONTACT_GAP_M = 0.5  # gated continuity: fitted start vs the previous flight's contact point
# Physical constraints inside the optimizer (penalties on a dense time grid), in the same
# units as pixel residuals: PHYS_W px per metre of violation.
PHYS_W = 50.0
DENSE_HZ = 30.0
# Reachable-contact REGION prior at a contact candidate, from the selected player's ground
# position (pose ankles): racket within REACH_M horizontally, height within CONTACT_H_M.
REACH_M, REACH_SD_M = 1.6, 0.3
CONTACT_H_M, CONTACT_H_SD_M = (0.6, 3.5), 0.2
HOLD_S = 0.2
MAX_FLIGHT_S = 3.0
MAX_NFEV = 80


def px_scale(cam):
    """Source pixels per TrackNet heatmap pixel (>= 1)."""
    return max(1.0, 2.0 * cam["principal_point_px"][0] / HEATMAP_W)


# ---------- physics ----------


def _deriv(s, k):
    v = s[:, 3:]
    speed = np.linalg.norm(v, axis=1, keepdims=True)
    a = -k * speed * v
    a[:, 2] += G
    return np.concatenate([v, a], axis=1)


def simulate(states, rel_times, k=DRAG_K):
    """states (K,6) at rel time 0 -> positions (K, M, 3) at sorted rel_times >= 0 (RK4)."""
    rel = np.asarray(rel_times, float)
    s = np.array(states, float)
    with np.errstate(over="ignore", invalid="ignore"):
        return _simulate(s, rel, k)


def _simulate(s, rel, k):
    span = float(rel[-1]) if len(rel) else 0.0
    steps = max(1, math.ceil(span / DT))
    h = span / steps if span > 0 else 0.0
    traj = np.empty((steps + 1, *s.shape))
    traj[0] = s
    for i in range(steps):
        k1 = _deriv(s, k)
        k2 = _deriv(s + 0.5 * h * k1, k)
        k3 = _deriv(s + 0.5 * h * k2, k)
        k4 = _deriv(s + h * k3, k)
        s = s + (h / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4)
        traj[i + 1] = s
    if span == 0:
        return np.repeat(traj[0][:, None, :3], len(rel), axis=1)
    pos = rel / h
    i0 = np.clip(np.floor(pos).astype(int), 0, steps - 1)
    w = (pos - i0)[None, :, None]
    p = traj[:, :, :3].transpose(1, 0, 2)  # (K, steps+1, 3)
    return p[:, i0] * (1 - w) + p[:, i0 + 1] * w


def project(cam, x):
    """x (..., 3) court points -> (pixels (..., 2), depth (...,))."""
    c = x @ cam["r"].T + cam["t"]
    depth = c[..., 2]
    p = c @ cam["k"].T
    with np.errstate(divide="ignore", invalid="ignore"):
        uv = p[..., :2] / p[..., 2:3]
    return uv, depth


# ---------- fitting one flight ----------


def _dense(rel):
    grid = np.linspace(0.0, rel[-1], max(2, math.ceil(rel[-1] * DENSE_HZ) + 1))
    allt = np.union1d(rel, grid)
    return allt, np.searchsorted(allt, rel)


def _residuals(
    cam,
    states,
    rel,
    obs,
    k,
    prior=(CONTACT_HEIGHT_M, CONTACT_HEIGHT_SD_M),
    anchor=None,
    contact=None,
    dense=None,
):
    allt, at_obs = dense if dense is not None else _dense(rel)
    xa = simulate(states, allt, k)
    x = xa[:, at_obs]
    uv, depth = project(cam, x)
    res = (uv - obs[None]).reshape(len(states), -1)
    res = np.where(np.isfinite(res), res, 1e4)
    behind = np.clip(0.5 - depth, 0, None) * 1e3
    height0 = -states[:, 2]
    pr = ((height0 - prior[0]) / prior[1])[:, None]
    h = -xa[:, :, 2]
    floor = PHYS_W * np.clip(-h, 0, None)  # non-negative height everywhere along the path
    y = xa[:, :, 1] - NET_Y_M
    cross = (y[:, 1:] * y[:, :-1] < 0) & (xa[:, 1:, 0] >= -0.3) & (xa[:, 1:, 0] <= 6.4)
    net = PHYS_W * np.where(
        cross, np.clip(NET_MIN_CLEAR_M - 0.5 * (h[:, 1:] + h[:, :-1]), 0, None), 0
    )
    parts = [res, behind, pr, floor, net]
    if anchor is not None:  # previous flight's position at the shared contact
        parts.append((states[:, :3] - anchor) / CONTACT_ANCHOR_SD_M)
    if contact is not None:  # reachable region around the hitting player's ground point
        d = np.linalg.norm(states[:, :2] - contact, axis=1)
        h0 = -states[:, 2]
        parts.append(
            np.c_[
                np.clip(d - REACH_M, 0, None) / REACH_SD_M,
                np.clip(CONTACT_H_M[0] - h0, 0, None) / CONTACT_H_SD_M,
                np.clip(h0 - CONTACT_H_M[1], 0, None) / CONTACT_H_SD_M,
            ]
        )
    return np.concatenate(parts, axis=1)


def _fit(
    cam,
    rel,
    obs,
    k,
    starts,
    prior=(CONTACT_HEIGHT_M, CONTACT_HEIGHT_SD_M),
    anchor=None,
    contact=None,
    return_all=False,
):
    from scipy.optimize import least_squares

    dense = _dense(rel)

    def fun(p):
        return _residuals(cam, p[None], rel, obs, k, prior, anchor, contact, dense)[0]

    def jac(p):
        eps = 1e-4 * np.maximum(1.0, np.abs(p))
        batch = np.vstack([p, p + np.diag(eps)])
        r = _residuals(cam, batch, rel, obs, k, prior, anchor, contact, dense)
        return ((r[1:] - r[0]) / eps[:, None]).T

    sols = [
        least_squares(
            fun, s0, jac=jac, method="trf", loss="soft_l1", f_scale=2.0, max_nfev=MAX_NFEV
        )
        for s0 in starts
    ]
    best = min(sols, key=lambda q: q.cost)
    if return_all:
        return best.x, [q.x for q in sols]
    return best.x


def _starts(cam, rel, obs):
    """Initial states from the first/last pixel rays at a few heights (drag ignored)."""
    out = []
    span = max(float(rel[-1]), 1e-3)
    for h0 in START_HEIGHTS_M:
        for h1 in END_HEIGHTS_M:
            a = ray_at_height(cam, obs[0], h0)
            b = ray_at_height(cam, obs[-1], h1)
            if a is None or b is None:
                continue
            x0 = np.array([a[0], a[1], -h0])
            x1 = np.array([b[0], b[1], -h1])
            v = (x1 - x0) / span
            v[2] -= 0.5 * G * span
            out.append(np.concatenate([x0, v]))
    return out


def _gates(cam, state, rel, obs, k):
    """Diagnostics and the first failed gate (or None) for a fitted state."""
    x = simulate(state[None], rel, k)[0]
    uv, depth = project(cam, x)
    res = np.linalg.norm(uv - obs, axis=1)
    dense_rel = np.linspace(0, rel[-1], max(2, int(rel[-1] / DT) + 1))
    xd = simulate(state[None], dense_rel, k)[0]
    heights = -xd[:, 2]
    d = {
        "image_rms_px": round(float(np.sqrt(np.mean(res**2))), 3),
        "image_max_px": round(float(res.max()), 3),
        "height_min_m": round(float(heights.min()), 3),
        "height_max_m": round(float(heights.max()), 3),
    }
    if not np.isfinite(res).all() or (depth <= 0).any():
        return d, "behind_camera"
    if d["image_rms_px"] > MAX_RMS_HM * px_scale(cam):
        return d, "image_rms"
    if d["image_max_px"] > OUTLIER_HM * px_scale(cam):
        return d, "image_max_residual"
    if d["height_min_m"] < MIN_HEIGHT_M or d["height_max_m"] > MAX_HEIGHT_M:
        return d, "height"
    x0, x1, y0, y1 = SURROUND
    if (
        (xd[:, 0] < x0).any()
        or (xd[:, 0] > x1).any()
        or (xd[:, 1] < y0).any()
        or (xd[:, 1] > y1).any()
    ):
        return d, "court_surround"
    side = np.sign(xd[:, 1] - NET_Y_M)
    for i in np.flatnonzero(side[1:] * side[:-1] < 0):
        if -0.3 <= xd[i, 0] <= 6.4 and heights[i] < NET_MIN_CLEAR_M:
            d["net_clearance_m"] = round(float(heights[i]), 3)
            return d, "net_clearance"
    return d, None


def fit_piece(cam, times, obs, anchor=None, contact=None):
    """Fit one candidate flight. Returns a diagnostics dict with 'accepted', 'reason',
    'state', 'k', 'outliers' (indices into obs) and 't0'."""
    times = np.asarray(times, float)
    obs = np.asarray(obs, float)
    t0 = times[0]
    rel = times - t0
    diag = {"n_obs": int(len(obs)), "t0": float(t0), "duration_s": round(float(rel[-1]), 3)}
    starts = _starts(cam, rel, obs)
    if anchor is not None:
        anchor = np.asarray(anchor, float)
        starts = [np.concatenate([anchor, s[3:]]) for s in starts]
        diag["anchored_start"] = True
    if contact is not None:
        contact = np.asarray(contact, float)
        starts = starts + [np.concatenate([contact, [-2.0], s[3:]]) for s in starts[:2]]
    if not starts:
        return {**diag, "accepted": False, "reason": "no_initial_guess"}
    fit_kw = {"anchor": anchor, "contact": contact}
    state, basins = _fit(cam, rel, obs, DRAG_K, starts, return_all=True, **fit_kw)
    diag["seeds"] = len(starts)
    competing = _competing_basins(cam, state, basins, rel, obs, anchor, contact)
    diag["competing_basin_m"] = competing
    uv, _ = project(cam, simulate(state[None], rel)[0])
    bad = np.linalg.norm(uv - obs, axis=1) > OUTLIER_HM * px_scale(cam)
    if bad.any():
        # Rejected observations partition the flight (the caller refits each side);
        # they are never just dropped from a fit they already shaped.
        return {
            **diag,
            "accepted": False,
            "reason": "outliers",
            "outliers": np.flatnonzero(bad).tolist(),
            "outlier_fraction": round(float(bad.mean()), 3),
        }
    if competing is not None and competing > MAX_AMBIGUITY_M:
        return {**diag, "accepted": False, "reason": "competing_basins"}
    if anchor is not None:
        gap = float(np.linalg.norm(state[:3] - anchor))
        diag["contact_continuity_m"] = round(gap, 3)
        if gap > MAX_CONTACT_GAP_M:
            return {**diag, "accepted": False, "reason": "contact_discontinuity"}
    keep = np.ones(len(obs), bool)
    rk, ok = rel, obs
    gd, failed = _gates(cam, state, rk, ok, DRAG_K)
    diag.update(gd)
    diag["outliers"] = np.flatnonzero(~keep).tolist()
    if failed:
        return {**diag, "accepted": False, "reason": failed}
    # Held-out reprojection: refit without every third observation, predict them.
    hold = np.zeros(len(rk), bool)
    hold[1:-1:3] = True
    if hold.sum() >= 1 and (~hold).sum() >= MIN_OBS:
        st_h = _fit(cam, rk[~hold], ok[~hold], DRAG_K, [state], **fit_kw)
        uv_h, _ = project(cam, simulate(st_h[None], rk)[0])
        diag["holdout_rms_px"] = round(
            float(np.sqrt(np.mean(np.sum((uv_h[hold] - ok[hold]) ** 2, axis=1)))), 3
        )
        if diag["holdout_rms_px"] > MAX_HOLDOUT_RMS_HM * px_scale(cam):
            return {**diag, "accepted": False, "reason": "holdout"}
    else:
        diag["holdout_rms_px"] = None
    # Sensitivity to the drag prior.
    base = simulate(state[None], rk)[0][:, :2]
    shift_m = 0.0
    for kk in DRAG_K_SENSITIVITY:
        st_k = _fit(cam, rk, ok, kk, [state], **fit_kw)
        shift_m = max(
            shift_m,
            float(np.linalg.norm(simulate(st_k[None], rk, kk)[0][:, :2] - base, axis=1).max()),
        )
    diag["drag_sensitivity_m"] = round(shift_m, 3)
    if shift_m > MAX_SENSITIVITY_M:
        return {**diag, "accepted": False, "reason": "drag_prior_sensitivity"}
    # Depth ambiguity: alternative start heights that still explain the pixels.
    amb = 0.0
    h_fit = float(-state[2])
    probes = (
        [] if anchor is not None else [h_fit + d for d in AMBIGUITY_OFFSETS_M if h_fit + d >= 0.3]
    )
    for h in probes:  # anchored: depth set by the shared contact / continuation
        alt = _fit(cam, rk, ok, DRAG_K, [state], prior=(h, 0.2), contact=contact)
        uv_a, _ = project(cam, simulate(alt[None], rk)[0])
        if np.sqrt(np.mean(np.sum((uv_a - ok) ** 2, axis=1))) <= MAX_RMS_HM * px_scale(cam):
            amb = max(
                amb, float(np.linalg.norm(simulate(alt[None], rk)[0][:, :2] - base, axis=1).max())
            )
    diag["depth_ambiguity_m"] = round(amb, 3)
    if amb > MAX_AMBIGUITY_M:
        return {**diag, "accepted": False, "reason": "depth_ambiguous"}
    diag["state0"] = [round(float(v), 4) for v in state]  # x, y, z(down), vx, vy, vz at t0
    diag["t0_s"] = round(float(t0), 6)
    diag["drag_k"] = DRAG_K
    return {**diag, "accepted": True, "reason": None, "state": state}


def _competing_basins(cam, best, sols, rel, obs, anchor=None, contact=None):
    """Largest xy disagreement between the best solution and any other independently seeded
    solution that explains the pixels comparably (RMS within max(1.5 x best, best + 0.5
    heatmap px) and the gate), stays above the floor and respects the same anchor / contact
    region factors."""
    xb = simulate(best[None], rel)[0]
    base = xb[:, :2]
    uvb, _ = project(cam, xb)
    rms_b = float(np.sqrt(np.mean(np.sum((uvb - obs) ** 2, axis=1))))
    limit = min(MAX_RMS_HM * px_scale(cam), max(1.5 * rms_b, rms_b + 0.5 * px_scale(cam)))
    worst = 0.0
    dense = np.linspace(0, rel[-1], max(2, int(rel[-1] / DT) + 1))
    for q in sols:
        x = simulate(q[None], rel)[0]
        uv, depth = project(cam, x)
        if not np.isfinite(uv).all() or (depth <= 0).any():
            continue
        rms = float(np.sqrt(np.mean(np.sum((uv - obs) ** 2, axis=1))))
        if rms > limit:
            continue
        if anchor is not None and np.linalg.norm(q[:3] - anchor) > MAX_CONTACT_GAP_M:
            continue
        if contact is not None and (
            np.linalg.norm(q[:2] - contact) > REACH_M + 0.5
            or not CONTACT_H_M[0] - 0.3 <= -q[2] <= CONTACT_H_M[1] + 0.3
        ):
            continue
        if float((-simulate(q[None], dense)[0][:, 2]).min()) < MIN_HEIGHT_M:
            continue
        worst = max(worst, float(np.linalg.norm(x[:, :2] - base, axis=1).max()))
    return round(worst, 3)


def _rebase(state, dt):
    """State at rel time dt later (dt may be negative: integrate backwards)."""
    if dt == 0:
        return state
    if dt > 0:
        s = simulate(state[None], [0.0, dt])[0]
        # velocity by finite difference of a short extra step
        s2 = simulate(state[None], [dt, dt + 1e-3])[0]
        return np.concatenate([s[-1], (s2[-1] - s2[0]) / 1e-3])
    # backwards: reverse time by flipping velocity under the same drag law is not exact;
    # integrate the reversed system with small RK4 steps instead.
    s = state.copy()
    steps = max(1, math.ceil(-dt / DT))
    h = dt / steps
    for _ in range(steps):
        k1 = _deriv(s[None], DRAG_K)[0]
        k2 = _deriv((s + 0.5 * h * k1)[None], DRAG_K)[0]
        k3 = _deriv((s + 0.5 * h * k2)[None], DRAG_K)[0]
        k4 = _deriv((s + h * k3)[None], DRAG_K)[0]
        s = s + (h / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4)
    return s


# ---------- segmentation ----------


def _turn(px, idx, j):
    if j < 2 or j > len(idx) - 3:
        return 0.0
    p0, p, p1 = (np.array(px[idx[j + d]]) for d in (-2, 0, 2))
    a, b = p - p0, p1 - p
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na < MIN_TURN_PX or nb < MIN_TURN_PX:
        return 0.0
    return float(np.degrees(np.arccos(np.clip(a @ b / (na * nb), -1, 1))))


def _contacts(px, idx, threshold):
    """Local maxima of the image turn angle above threshold (positions within idx)."""
    ang = [_turn(px, idx, j) for j in range(len(idx))]
    out = []
    for j, a in enumerate(ang):
        if a > threshold and a == max(ang[max(0, j - 2) : j + 3]) and (not out or j - out[-1] > 2):
            out.append(j)
    return out, ang


def _pieces(px, pts, idx, cam=None, players=None):
    """Split one run (indices of observed frames) at contact candidates; pieces share the
    contact observation. With pose rows, a candidate also needs a plausible hitter."""
    cuts, _ = _contacts(px, idx, TURN_DEG)
    if players is not None and cam is not None:
        cuts = [
            j
            for j in cuts
            if (h := _hitter(cam, px[idx[j]], players[idx[j]])) is not None
            and h[0] <= CONTACT_PLAUSIBLE_M
        ]
    bounds = [0, *cuts, len(idx) - 1]
    out = []
    for n_piece, (a, b) in enumerate(zip(bounds, bounds[1:], strict=False)):
        piece = idx[a : b + 1]
        at_contact = n_piece > 0  # the run's opening piece has no observed contact
        while pts[piece[-1]] - pts[piece[0]] > MAX_FLIGHT_S and len(piece) > 2 * MIN_OBS:
            half = len(piece) // 2
            out.append((piece[: half + 1], at_contact))
            piece, at_contact = piece[half:], False
        out.append((piece, at_contact))
    return out


def _hitter(cam, px, players):
    """Player whose ground point the pixel ray passes closest to at racket heights."""
    best = None
    for p in players or []:
        g = p.get("court_xy_m")
        if g is None:
            continue
        for h in (1.0, 2.0, 3.0):
            xy = ray_at_height(cam, px, h)
            if xy is None:
                continue
            d = float(np.hypot(xy[0] - g[0], xy[1] - g[1]))
            if best is None or d < best[0]:
                best = (d, p["id"], [float(g[0]), float(g[1])])
    return best


# ---------- builder ----------


def _spikes(px, observed, spike_px):
    """Isolated detections: far from both observed neighbours (within 2 frames) that agree."""
    out = set()
    for j in range(1, len(observed) - 1):
        a, i, b = observed[j - 1], observed[j], observed[j + 1]
        if b - a > 4:
            continue
        pa, pi, pb = (np.array(px[q], float) for q in (a, i, b))
        if (
            np.linalg.norm(pi - pa) > spike_px
            and np.linalg.norm(pi - pb) > spike_px
            and np.linalg.norm(pb - pa) < spike_px
        ):
            out.add(i)
    return out


def _continuation_outliers(px, pts, observed, thr):
    """Observations that disagree with BOTH a left and a right quadratic extrapolation which
    agree with each other (a contact keeps position, so it passes; a wrong-object block does
    not). Windows skip CONT_SKIP neighbours on each side so short blocks are found."""
    out = set()
    for _ in range(3):  # iterate: windows exclude samples already rejected
        new = _cont_pass(px, pts, [i for i in observed if i not in out], observed, thr, out)
        if not new:
            break
        out |= new
    return out


def _cont_pass(px, pts, clean, observed, thr, done):
    out = set()
    for i in observed:
        if i in done:
            continue
        pos = np.searchsorted(clean, i)
        left = [q for q in clean[max(0, pos - 1 - CONT_SKIP - CONT_WIN) : pos] if q < i - CONT_SKIP]
        left = left[-CONT_WIN:]
        right = [q for q in clean[pos : pos + 2 + CONT_SKIP + CONT_WIN] if q > i + CONT_SKIP]
        right = right[:CONT_WIN]
        if len(left) < 4 or len(right) < 4:
            continue
        preds = []
        for side in (left, right):
            ts = np.array([pts[q] - pts[i] for q in side])
            if np.abs(ts).max() > 0.5:
                break
            uv = np.array([px[q] for q in side], float)
            preds.append([np.polyval(np.polyfit(ts, uv[:, c], 2), 0.0) for c in (0, 1)])
        if len(preds) < 2:
            continue
        pl, pr, p = np.array(preds[0]), np.array(preds[1]), np.array(px[i], float)
        if (
            np.linalg.norm(pl - pr) < thr
            and min(np.linalg.norm(p - pl), np.linalg.norm(p - pr)) > thr
        ):
            out.add(i)
    return out


def _unavailable(n, note):
    return {"status": "unavailable", "method": METHOD, "note": note}, [None] * n


def build_flight_reference(
    pts, shuttle_px, segments, calibrated_segment, cam, *, reason=None, players=None
):
    """(top-level metadata, per-frame refs or None). Never alters shuttle_px."""
    n = len(pts)
    if cam is None:
        return _unavailable(n, f"No conditional shuttle reference: {reason or 'no camera'}.")
    if calibrated_segment is None or not 0 <= calibrated_segment < len(segments):
        return _unavailable(n, "No conditional shuttle reference: no calibrated camera segment.")
    a, b = segments[calibrated_segment]
    observed = [i for i in range(a, b) if shuttle_px[i] is not None]
    if not observed:
        return _unavailable(n, "No conditional shuttle reference: no shuttle observation.")
    spikes = _spikes(shuttle_px, observed, SPIKE_HM * px_scale(cam))
    spikes |= _continuation_outliers(shuttle_px, pts, observed, OUTLIER_HM * px_scale(cam))
    observed = [i for i in observed if i not in spikes]
    if not observed:
        return _unavailable(n, "No conditional shuttle reference: no usable shuttle observation.")
    runs, cur = [], [observed[0]]
    for i in observed[1:]:
        if pts[i] - pts[cur[-1]] > MAX_GAP_S:
            runs.append(cur)
            cur = []
        cur.append(i)
    runs.append(cur)

    refs = [None] * n
    flights = []
    rejected = set(spikes)
    ends = {}  # start frame -> anchored model position (shared contact or continuation)
    continues = {}  # first index of a part after a rejected block -> first index of the part before
    queue = [p for run in runs for p in _pieces(shuttle_px, pts, run, cam, players)]
    while queue:
        piece, at_contact = queue.pop(0)
        if len(piece) < MIN_OBS:
            flights.append(
                {
                    "frames": [piece[0], piece[-1]],
                    "n_obs": len(piece),
                    "accepted": False,
                    "reason": "too_few_observations",
                }
            )
            rejected.update(piece)
            continue
        contact = None
        hit = (
            _hitter(cam, shuttle_px[piece[0]], players[piece[0]])
            if at_contact and players
            else None
        )
        if hit is not None:
            contact = hit[2]
        res = fit_piece(
            cam,
            [pts[i] for i in piece],
            [shuttle_px[i] for i in piece],
            anchor=ends.get(piece[0]),
            contact=contact,
        )
        res["frames"] = [piece[0], piece[-1]]
        if hit is not None:
            res["contact_prior"] = {
                "player": hit[1],
                "ground_xy_m": [round(v, 3) for v in hit[2]],
                "frame": piece[0],
                "reach_m": REACH_M,
                "height_m": list(CONTACT_H_M),
            }
        if res["reason"] == "outliers" and res.get("outlier_fraction", 1.0) <= MAX_OUTLIER_FRACTION:
            bad = {piece[j] for j in res["outliers"]}
            rejected.update(bad)
            flights.append(_public({**res, "reason": "partitioned_at_rejected_observations"}))
            parts, cur = [], []
            for i in piece:
                if i in bad:
                    if cur:
                        parts.append(cur)
                    cur = []
                else:
                    cur.append(i)
            if cur:
                parts.append(cur)
            for prev_part, next_part in zip(parts, parts[1:], strict=False):
                continues[next_part[0]] = prev_part[0]  # same flight: no contact in between
            queue[:0] = [(q, at_contact and q[0] == piece[0]) for q in parts]
            continue
        if not res["accepted"] and res["reason"] not in ("no_initial_guess",):
            sub, ang = _contacts(shuttle_px, piece, SECONDARY_TURN_DEG)
            sub = [j for j in sub if MIN_OBS - 1 <= j <= len(piece) - MIN_OBS]
            if sub:  # one more split at the sharpest secondary candidate
                j = max(sub, key=lambda q: ang[q])
                queue[:0] = [(piece[: j + 1], at_contact), (piece[j:], True)]
                continue
        state = res.pop("state", None)
        out_idx = {piece[j] for j in res.get("outliers", [])}
        if not res["accepted"]:
            rejected.update(piece)
            flights.append(_public(res))
            continue
        fid = f"auto_f{len([f for f in flights if f.get('accepted')]) + 1}"
        res["flight_id"] = fid
        flights.append(_public(res))
        rejected.update(out_idx)
        frames = list(range(piece[0], piece[-1] + 1))
        rel = np.array([pts[i] - res["t0"] for i in frames])
        x = simulate(state[None], rel)[0]
        if piece[-1] not in out_idx:
            ends[piece[-1]] = x[-1].copy()
        for nxt, prv in continues.items():  # gated continuity across a rejected block
            if prv == piece[0] and nxt not in ends:
                ends[nxt] = simulate(state[None], [0.0, pts[nxt] - res["t0"]])[0][-1].copy()
        for i, p in zip(frames, x, strict=True):
            if i in out_idx:
                continue
            xy = [round(float(p[0]), 3), round(float(p[1]), 3)]
            refs[i] = {
                "status": "estimated" if shuttle_px[i] is not None else "interpolated",
                "xy_m": xy,
                "xyz_m": [*xy, round(float(-p[2]), 3)],
                "flight_id": fid,
                "reference_frame_id": None,
                "reference_pts_s": None,
            }
        # A contact observation shared with the next piece is re-assigned by the next fit.
    for i in rejected:  # rejected observations are barriers: nothing shown there
        refs[i] = None
    _hold_after_flights(refs, pts, a, b, rejected)
    accepted = [f for f in flights if f.get("accepted")]
    if not accepted:
        return _unavailable(n, "No conditional shuttle reference: no flight passed the fit gates.")[
            0
        ] | {"flights": flights}, [None] * n
    counts = {
        s: sum(1 for r in refs if r and r["status"] == s)
        for s in ("estimated", "interpolated", "reference")
    }
    counts["rejected"] = len(rejected)
    counts["none"] = sum(1 for r in refs if r is None)
    counts["flights_accepted"] = len(accepted)
    counts["flights_rejected"] = len(flights) - len(accepted)
    centre = cam["centre_m"]
    top = {
        "status": "conditional_reference",
        "method": (
            f"{METHOD}: per-flight 3D fit (gravity + quadratic drag) of TrackNet pixels at "
            "actual PTS through a camera inferred from the automatic floor homography"
        ),
        "note": (
            "Display-only conditional model estimate, NOT a measurement. estimated/interpolated = "
            "fitted flight position at an observed / detector-null frame; reference = a flight's "
            "last observed position held briefly with its own time. Rejected observations and "
            "failed flights show nothing. Raw observations are unchanged."
        ),
        "assumptions": [
            f"Gravity {G} m/s^2 and quadratic drag k = {DRAG_K} 1/m (prior, not measured; "
            f"sensitivity checked at {DRAG_K_SENSITIVITY[0]}/{DRAG_K_SENSITIVITY[1]}).",
            "Depth comes from the gravity/drag curvature of the pixel track; a weak prior puts "
            f"each flight's first point near {CONTACT_HEIGHT_M} m (sd {CONTACT_HEIGHT_SD_M} m).",
            "Camera: principal point at the image centre, square pixels, zero skew; focal length "
            f"{cam['focal_px']:.0f} px and centre ({centre[0]:.1f}, {centre[1]:.1f}) m at "
            f"{centre[2]:.1f} m height derived from the automatic floor homography, not surveyed.",
            "Flights are split at sharp image direction changes (contact candidates) and detector "
            f"gaps over {MAX_GAP_S} s; contact times are not reviewed.",
            "A flight that starts at the previous accepted flight's last observation (shared "
            f"contact) is anchored to that model position (sd {CONTACT_ANCHOR_SD_M} m): a contact "
            "changes velocity, not position.",
            "Image residuals do not certify 3D accuracy.",
        ],
        "coordinate_system": {
            "x_m": "0..6.1 across, x=0 image-left doubles sideline",
            "y_m": "0 FAR end .. 13.4 NEAR camera end; net y=6.7",
            "z_m": "xyz_m[2] = model height above the floor (conditional)",
            "bounds": "not clipped; off-court values are kept",
        },
        "camera": {
            "focal_px": round(cam["focal_px"], 2),
            "principal_point_px": cam["principal_point_px"],
            "centre_m": [round(v, 3) for v in centre],
            "checks": cam["checks"],
        },
        "thresholds": {
            "min_obs": MIN_OBS,
            "max_gap_s": MAX_GAP_S,
            "turn_deg": TURN_DEG,
            "secondary_turn_deg": SECONDARY_TURN_DEG,
            "source_px_per_heatmap_px": round(px_scale(cam), 3),
            "outlier_px": OUTLIER_HM * px_scale(cam),
            "max_outlier_fraction": MAX_OUTLIER_FRACTION,
            "max_rms_px": MAX_RMS_HM * px_scale(cam),
            "max_holdout_rms_px": MAX_HOLDOUT_RMS_HM * px_scale(cam),
            "height_m": [MIN_HEIGHT_M, MAX_HEIGHT_M],
            "surround_m": list(SURROUND),
            "net_min_clear_m": NET_MIN_CLEAR_M,
            "max_drag_sensitivity_m": MAX_SENSITIVITY_M,
            "spike_px": SPIKE_HM * px_scale(cam),
            "drag_k_sensitivity": list(DRAG_K_SENSITIVITY),
            "hold_s": HOLD_S,
            "max_flight_s": MAX_FLIGHT_S,
            "ambiguity_offsets_m": list(AMBIGUITY_OFFSETS_M),
            "max_depth_ambiguity_m": MAX_AMBIGUITY_M,
            "min_turn_px": MIN_TURN_PX,
            "start_heights_m": list(START_HEIGHTS_M),
            "end_heights_m": list(END_HEIGHTS_M),
            "contact_plausible_m": CONTACT_PLAUSIBLE_M,
            "continuation_window": CONT_WIN,
            "continuation_skip": CONT_SKIP,
        },
        "segment_id": f"s{calibrated_segment}",
        "counts": counts,
        "flights": flights,
    }
    return top, refs


def _public(res):
    keep = (
        "flight_id",
        "frames",
        "n_obs",
        "duration_s",
        "accepted",
        "reason",
        "anchored_start",
        "image_rms_px",
        "image_max_px",
        "holdout_rms_px",
        "height_min_m",
        "height_max_m",
        "drag_sensitivity_m",
        "depth_ambiguity_m",
        "outliers",
        "net_clearance_m",
        "contact_prior",
        "contact_continuity_m",
        "outlier_fraction",
        "state0",
        "t0_s",
        "drag_k",
        "seeds",
        "competing_basin_m",
    )
    return {k: _finite(res[k]) for k in keep if k in res}


def _finite(v):
    """Strict JSON: non-finite diagnostics become null."""
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, list):
        return [_finite(x) for x in v]
    if isinstance(v, dict):
        return {k: _finite(x) for k, x in v.items()}
    return v


def _hold_after_flights(refs, pts, a, b, rejected):
    """After an estimated frame with no following ref, hold it for at most HOLD_S (past only)."""
    seed = None
    for i in range(a, b):
        if i in rejected:
            seed = None
            continue
        r = refs[i]
        if r is not None:
            seed = i if r["status"] == "estimated" else None
            continue
        if seed is None or pts[i] - pts[seed] > HOLD_S + 1e-9:
            seed = None if seed is not None and pts[i] - pts[seed] > HOLD_S + 1e-9 else seed
            continue
        s = refs[seed]
        refs[i] = {
            "status": "reference",
            "xy_m": s["xy_m"],
            "xyz_m": s["xyz_m"],
            "flight_id": None,
            "reference_frame_id": seed,
            "reference_pts_s": pts[seed],
        }
