# SPDX-License-Identifier: AGPL-3.0-only
"""Joint contact-to-contact flight graph for the top-view shuttle DISPLAY reference.

Every impact is a shared 3D node with a bounded contact time; each flight between two
nodes has its own launch velocity. A contact changes velocity, never position: the flight
arriving at a node must reach the node's position at the node's time (continuity block),
and the next flight starts there. All nodes, contact times, launch velocities and one
bounded global drag constant are optimised TOGETHER (one sparse ``least_squares``) against:

* image reprojection of the actual TrackNet pixels at their capture times;
* reachable-contact REGION priors at impact nodes from the selected player's pose ground
  point (racket within reach horizontally, contact height band), never the player position
  substituted as the shuttle position;
* gravity + quadratic drag dynamics, non-negative height, camera-facing points and net
  clearance (1.524 m) on a dense time grid;
* a disclosed log-normal drag prior.

Contacts are inferred automatically from velocity discontinuities of the pixel track (local
quadratic fits on each side, so smooth apices do not qualify), including contacts hidden in
detector gaps, and require a plausible hitter. Gaps without such evidence keep the SAME
flight (a missing bridge never starts a new unanchored depth branch). The first flight of a
run starts at a free clip-boundary node at its first observation (no receiver contact is
forced at a clip/gap edge); the last flight ends at its last observation.

After the joint MAP fit, every flight is re-integrated independently on a fine step and
checked (JOINT-REFERENCE criteria J1-J5, see ``CRITERIA``). The result is a conditional
best hypothesis under stated priors, not measured 3D: no speeds are published.
"""

from __future__ import annotations

import math
import time

import numpy as np

from . import flightfit
from .flightfit import G, project, px_scale
from .shuttleref import ray_at_height

METHOD = "auto_joint_flight_v1"
# Image noise: TrackNet localises on a 512-px-wide heatmap grid (quantisation sd 1/sqrt(12)
# heatmap px) plus peak jitter; robust residuals of the real track are ~1 heatmap px.
SIGMA_HM = 1.0
OUTLIER_HM = 6.0  # observations beyond this joint residual are excluded (reported)
CONT_SD_M = 0.01  # continuity block: arriving flight must hit the node position
REACH_M, REACH_SD_M = 1.6, 0.25
CONTACT_H_M, CONTACT_H_SD_M = (0.25, 3.6), 0.1
CONTACT_H_PRIOR = (1.8, 1.2)  # weak, disclosed: mean/sd of an impact height (m)
CFR_TOL = 0.1  # cadence inference only on a constant-frame-rate clock (PTS step spread)
RECEIVER_SD_M_S = 1.0  # open-tail direction prior (m/s of launch away from the net)
DRAG_K0, DRAG_LOG_SD, DRAG_BOUNDS = 0.21, 0.35, (0.12, 0.40)
# Hierarchical drag: each flight's k = global k * exp(d), d ~ N(0, DRAG_FLIGHT_SD), bounded.
DRAG_FLIGHT_SD, DRAG_FLIGHT_MAX = 0.15, 0.4
NET_Y_M, NET_H_M, NET_X_M = 6.7, 1.524, (0.0, 6.1)
PHYS_SD_M = 0.005  # metres of floor/net violation per residual unit
STEPS = 40  # fixed RK4 steps per flight (smooth in contact times)
MAX_BRIDGE_S = 1.2  # longer detector gaps end a run (no flight is bridged over it)
JUMP_WIN, JUMP_SPAN_S = 5, 0.25
MIN_IMPULSE_MS = 4.0  # a fitted contact with a smaller velocity change is removed
MAX_DROPS = 6
REPAIR_ATTEMPTS = 3
LOCAL_HEIGHTS_M = (0.5, 1.8, 3.2)  # impact-node depth starts along the node's pixel ray
LOCAL_TIME_FRACTION = 0.75  # alternative contact-time start inside its bounds
LOCAL_NFEV, LOCAL_POLISH_NFEV = 20, 30
LOCAL_BUDGET_S = 45.0  # wall budget for all local multistarts of one run
MERGE_TOLERANCE = 0.05  # coverage loss accepted to remove a physically impossible contact
REDETECT_MAX_FRACTION = 0.1  # re-detect contacts without exclusions only if they are few
GAP_FRAMES = 3  # a detector gap of this many frames can hide a contact
JUMP_REL, JUMP_MIN_HM_S = 0.35, 60.0  # velocity discontinuity: relative and absolute floors
# Hitter region in the image, in units of the player's pose box height (a standing player
# ~1.75 m; arm + racket reach ~1.6 m sideways, contacts up to ~3.6 m high).
REACH_BOX_W, REACH_BOX_UP, REACH_BOX_DOWN = 0.9, 1.0, 0.15
MIN_FLIGHT_OBS = 4
# Locked evaluation partition: source frame index % EVAL_EVERY == EVAL_PHASE, fixed before any
# trajectory-dependent processing; those pixels never enter cadence, outliers, contacts,
# graph selection, initialisation, fitting, local search or polish.
EVAL_EVERY, EVAL_PHASE = 4, 2
SURROUND = flightfit.SURROUND
CRITERIA = {
    "J1_continuity_m": 0.10,  # independent fine re-integration end vs the shared node
    "J2_inlier_rms_hm": 2.0,  # per-flight inlier image RMS (heatmap px)
    "J2_min_inlier_fraction": 0.7,
    "J3_holdout_rms_hm": 3.0,  # locked evaluation frames, frozen selected model, inliers
    "J3_min_inlier_fraction": 0.7,
    "J4_height_m": (-0.05, 15.0),  # dense path; net crossings >= 1.524 m - 0.03
    "J4_net_tol_m": 0.03,
    "J5_surround_m": list(SURROUND),
}


# ---------- capture times ----------


def capture_times(pts, shuttle_px, observed):
    """Frame-repeat cadence (e.g. 25 fps content in a 30 fps file repeats every 6th frame).

    Detected from near-identical consecutive shuttle pixels concentrated in ONE phase of a
    period; repeated frames carry no new evidence and are excluded from the fit. Unique
    frames get uniform source-rate capture times. Returns (times, repeats, info)."""
    t = np.array(pts, float)
    obs = set(observed)
    if len(pts) < 30:
        return t, set(), None
    d = np.diff(t)
    med = float(np.median(d))
    if med <= 0 or float(np.abs(d - med).max()) > CFR_TOL * med:
        return t, set(), None  # variable frame rate: keep PTS, never force a uniform clock
    fps = 1.0 / med
    near = []
    for i in observed:
        if i - 1 in obs:
            d = np.abs(np.subtract(shuttle_px[i], shuttle_px[i - 1])).max()
            near.append((i, d < 1.5))
    for period in (6, 5):
        pairs = [(i % period, s) for i, s in near]
        best = None
        for r in range(period):
            at = [s for q, s in pairs if q == r]
            if len(at) >= 8:
                frac = sum(at) / len(at)
                other = [s for q, s in pairs if q != r]
                rest = sum(other) / max(1, len(other))
                if frac >= 0.6 and rest <= 0.15 and (best is None or frac > best[1]):
                    best = (r, frac)
        if best is None:
            continue
        r = best[0]
        repeats = {i for i in range(1, len(pts)) if i % period == r}
        uniq = [i for i in range(len(pts)) if i not in repeats]
        src = fps * (period - 1) / period
        tu = np.arange(len(uniq)) / src
        tu += np.mean(t[uniq] - tu)
        tc = np.empty_like(t)
        tc[uniq] = tu
        for i in sorted(repeats):
            tc[i] = tc[i - 1]
        info = {
            "period_frames": period,
            "repeat_phase": r,
            "repeat_fraction": round(best[1], 3),
            "source_fps": round(src, 3),
            "epoch_s": round(float(tu[0]), 6),
            "rule": "unique frame m -> epoch_s + m / source_fps; a repeated frame keeps the "
            "previous unique frame's time and is excluded from the fit",
        }
        return tc, repeats & obs, info
    return t, set(), None


# ---------- contact candidates ----------


def _local_fit(ts, uv, t):
    """Position and velocity at t of a quadratic (or line) fit."""
    deg = 2 if len(ts) >= 4 else 1
    cu = [np.polyfit(ts - t, uv[:, c], deg) for c in (0, 1)]
    return np.array([c[-1] for c in cu]), np.array([c[-2] for c in cu]), cu


def _is_gap(a, b, structural):
    """A detector gap between samples a < b: at least GAP_FRAMES apart AND at least one
    genuinely missing frame. Known sampling holes alone (locked evaluation mask, repeated
    source frames) are not a gap; without such structure this is the plain spacing rule."""
    return b - a >= GAP_FRAMES and any(q not in structural for q in range(a + 1, b))


def _jump(px, tc, clean, j_left, j_right, t, structural=frozenset()):
    """Velocity discontinuity: fits ending at clean[j_left] vs starting at clean[j_right]."""
    # Windows stop at detector gaps (>= GAP_FRAMES): a gap may hide another contact.
    left = [clean[j_left]]
    for q in clean[max(0, j_left - JUMP_WIN + 1) : j_left][::-1]:
        if _is_gap(q, left[-1], structural) or tc[q] < t - JUMP_SPAN_S:
            break
        left.append(q)
    left.reverse()
    right = [clean[j_right]]
    for q in clean[j_right + 1 : j_right + JUMP_WIN]:
        if _is_gap(right[-1], q, structural) or tc[q] > t + JUMP_SPAN_S:
            break
        right.append(q)
    if len(left) < 2 or len(right) < 2:  # two samples: a line (velocity only)
        return None
    pl, vl, cl = _local_fit(tc[left], np.array([px[q] for q in left], float), t)
    pr, vr, cr = _local_fit(tc[right], np.array([px[q] for q in right], float), t)
    dv = float(np.linalg.norm(vr - vl))
    rel = dv / max(np.linalg.norm(vl), np.linalg.norm(vr), 1e-6)
    return dv, rel, float(np.linalg.norm(pr - pl)), (cl, cr)


def _gap_meeting(fits, t, lo, hi):
    """Inside a gap: time and pixel where the two one-sided extrapolations come closest."""
    cl, cr = fits
    best = None
    for tt in np.linspace(lo, hi, 13):
        a = np.array([np.polyval(c, tt - t) for c in cl])
        b = np.array([np.polyval(c, tt - t) for c in cr])
        d = float(np.linalg.norm(a - b))
        if best is None or d < best[0]:
            best = (d, float(tt), (0.5 * (a + b)).tolist())
    return best[1], best[2]


def receiver_direction_residual(ground_y, v):
    """Open tail: a launch from one half must head towards the net / receiver half (soft)."""
    toward = 1.0 if ground_y < NET_Y_M else -1.0
    return max(0.0, -float(v[1]) * toward) / RECEIVER_SD_M_S


def merge_candidates(nodes):
    """Contact frames to test for merging: the less reachable of two consecutive contacts by
    the same player (singles needs an opponent hit in between), or any contact far beyond
    the soft reach prior."""
    out = set()
    hits = [n for n in nodes if n["kind"] == "contact"]
    for a, b in zip(hits, hits[1:], strict=False):
        if a["player"] == b["player"]:
            out.add(max((a, b), key=lambda q: q["reach_distance_m"])["frame"])
    for n in hits:
        if n["reach_distance_m"] > REACH_M + 2 * REACH_SD_M:
            out.add(n["frame"])
    return sorted(out)


def _hitter(cam, pxs, players):
    """Which selected player can have hit at these pixel(s): the pixel must lie in the
    player's pose box widened by arm+racket reach (REACH_BOX_W box heights each side,
    REACH_BOX_UP above, REACH_BOX_DOWN below); the closest box centre (in box heights) wins.
    Returns (normalised distance, id, pose ground xy, ray height nearest the ground point,
    ray xy at that height) or None. Only WHICH player is taken from the image box; the 3D
    region prior uses the pose ground point, never a racket pixel."""
    best = None
    for p in players or []:
        g, box = p.get("court_xy_m"), p.get("box_px")
        if g is None or box is None:
            continue
        x0, y0, x1, y1 = box
        bh = max(y1 - y0, 1.0)
        for px in pxs:
            u, v = px
            if not (
                x0 - REACH_BOX_W * bh <= u <= x1 + REACH_BOX_W * bh
                and y0 - REACH_BOX_UP * bh <= v <= y1 + REACH_BOX_DOWN * bh
            ):
                continue
            dn = math.hypot(u - 0.5 * (x0 + x1), v - 0.5 * (y0 + y1)) / bh
            if best is not None and dn >= best[0]:
                continue
            ray = None
            for h in np.linspace(CONTACT_H_M[0], CONTACT_H_M[1], 14):
                xy = ray_at_height(cam, px, float(h))
                if xy is None:
                    continue
                d = float(np.hypot(xy[0] - g[0], xy[1] - g[1]))
                if ray is None or d < ray[0]:
                    ray = (d, float(h), [float(xy[0]), float(xy[1])])
            if ray is not None:
                best = (dn, p["id"], [float(g[0]), float(g[1])], ray[1], ray[2])
    return best


def find_contacts(cam, px, tc, clean, players, scale, corrupt=frozenset(), structural=frozenset()):
    """Contact candidates on the clean observation list: at a sample (cusp) or inside a
    detector-null gap (a gap left by REJECTED samples keeps the same flight). Strongest first,
    one per 0.2 s, each needing a plausible hitter and MIN_FLIGHT_OBS samples between
    contacts. Returns dicts with location, time bounds and the hitter region."""
    cands = []
    for j in range(1, len(clean) - 1):
        i = clean[j]
        r = _jump(px, tc, clean, j, j, tc[i], structural)
        if r is not None:
            cands.append({"j": j, "kind": "sample", "t": tc[i], "score": r})
    for j in range(len(clean) - 1):
        a, b = clean[j], clean[j + 1]
        if (
            _is_gap(a, b, structural)
            and tc[b] - tc[a] <= MAX_BRIDGE_S
            and not any(q in corrupt for q in range(a + 1, b))
        ):
            tm = 0.5 * (tc[a] + tc[b])
            r = _jump(px, tc, clean, j, j + 1, tm, structural)
            if r is not None:
                cands.append({"j": j, "kind": "gap", "t": tm, "score": r})
    floor = JUMP_MIN_HM_S * scale
    ok = [c for c in cands if c["score"][1] >= JUMP_REL and c["score"][0] >= floor]
    ok.sort(key=lambda c: -c["score"][0])
    chosen = []
    for c in ok:  # strongest first; one contact per neighbourhood
        if any(abs(c["t"] - d["t"]) < 0.2 for d in chosen):
            continue
        j = c["j"]
        between = [
            sum(1 for q in clean if min(c["t"], d["t"]) < tc[q] < max(c["t"], d["t"]))
            for d in chosen
        ]
        if any(m < MIN_FLIGHT_OBS for m in between):
            continue
        if c["kind"] == "sample":
            i = clean[j]
            pxc, lo, hi = [px[i]], tc[clean[j - 1]], tc[clean[j + 1]]
            frames = [clean[j - 1], clean[j + 1]]
        else:
            a, b = clean[j], clean[j + 1]
            # The impact can precede/follow the gap edge sample within its exposure interval:
            # bounds reach the neighbouring samples (they are assigned by the contact time).
            lo = tc[clean[j - 1]] if j >= 1 else tc[a]
            hi = tc[clean[j + 2]] if j + 2 < len(clean) else tc[b]
            i = a
            c["t"], meet = _gap_meeting(c["score"][3], c["t"], lo, hi)
            pxc = [meet]
            frames = [a, b]
        hit = _hitter(cam, pxc, players[i] if players else None)
        if hit is None:
            continue
        c["score"] = c["score"][:3]
        chosen.append(
            {**c, "t_bounds": (float(lo), float(hi)), "frames": frames, "hit": hit, "frame": i}
        )
    chosen.sort(key=lambda c: c["t"])
    return chosen, len(cands)


# ---------- graph ----------


class Graph:
    """Nodes (boundary/contact) and flights of one run, with a flat parameter layout."""

    def __init__(self, run, contacts, tc, px, scale):
        self.tc, self.px, self.scale = tc, px, scale
        self.nodes, self.flights = [], []
        bounds = []  # (t_lo, t_hi) per contact
        self.nodes.append(
            {"kind": "clip_boundary", "t": float(tc[run[0]]), "free_t": False, "frame": run[0]}
        )
        for c in contacts:
            self.nodes.append(
                {
                    "kind": "contact",
                    "t": float(c["t"]),
                    "free_t": True,
                    "t_bounds": c["t_bounds"],
                    "hit": c["hit"],
                    "frame": c["frame"],
                    "frames": c["frames"],
                }
            )
            bounds.append(c["t_bounds"])
        for n in range(len(self.nodes)):
            self.flights.append({"a": n, "b": n + 1 if n + 1 < len(self.nodes) else None})
        # Observations: every clean sample belongs to the flight whose time span contains
        # it; a sample inside a contact's time bounds is assigned dynamically by the
        # contact time (in or out flight) inside the residuals.
        self.obs_t = np.array([tc[i] for i in run])
        self.obs_px = np.array([px[i] for i in run], float)
        self.obs_frame = list(run)
        self.t_end = float(tc[run[-1]])
        # parameter layout
        col = 1  # 0 = log drag
        for nd in self.nodes:
            nd["col"] = col
            col += 4 if nd["free_t"] else 3
        for fl in self.flights:
            fl["col"] = col  # launch velocity (3) + per-flight log-drag offset (1)
            col += 4
        self.n_params = col

    def unpack(self, p):
        k = np.exp(p[0] + np.array([p[fl["col"] + 3] for fl in self.flights]))
        P = np.array([p[nd["col"] : nd["col"] + 3] for nd in self.nodes])
        T = np.array([p[nd["col"] + 3] if nd["free_t"] else nd["t"] for nd in self.nodes])
        V = np.array([p[fl["col"] : fl["col"] + 3] for fl in self.flights])
        return k, P, T, V


def _rk4_grid(s0, span, k):
    """Batched fixed-step RK4: s0 (F,6), span (F,) -> states (F, STEPS+1, 6), h (F,).

    Acceleration depends on velocity only, so the stages run on velocities and positions
    use the exact RK4 combination x += h v + h^2/6 (k1 + k2 + k3)."""
    h = (span / STEPS)[:, None]
    x, v = s0[:, :3].copy(), s0[:, 3:].copy()
    out = np.empty((len(s0), STEPS + 1, 6))
    out[:, 0, :3], out[:, 0, 3:] = x, v
    gv = np.array([0.0, 0.0, G])
    k = np.broadcast_to(np.asarray(k, float), (len(s0),))[:, None]

    def acc(u):
        return gv - k * np.sqrt(np.einsum("ij,ij->i", u, u))[:, None] * u

    hh = 0.5 * h
    for m in range(STEPS):
        a1 = acc(v)
        a2 = acc(v + hh * a1)
        a3 = acc(v + hh * a2)
        a4 = acc(v + h * a3)
        x = x + h * v + (h * h / 6.0) * (a1 + a2 + a3)
        v = v + (h / 6.0) * (a1 + 2 * a2 + 2 * a3 + a4)
        out[:, m + 1, :3], out[:, m + 1, 3:] = x, v
    return out, h[:, 0]


def _eval(grid, h, rel, k):
    """Cubic Hermite positions at rel times (F, M) on each flight's grid; Taylor outside."""
    F, M = rel.shape
    pos = np.clip(rel / h[:, None], 0, STEPS - 1e-9)
    i0 = np.floor(pos).astype(int)
    u = (pos - i0)[..., None]
    fi = np.arange(F)[:, None]
    s0, s1 = grid[fi, i0], grid[fi, i0 + 1]
    hh = h[:, None, None]
    p0, v0, p1, v1 = s0[..., :3], s0[..., 3:], s1[..., :3], s1[..., 3:]
    h00, h10, h01, h11 = (
        2 * u**3 - 3 * u**2 + 1,
        u**3 - 2 * u**2 + u,
        -2 * u**3 + 3 * u**2,
        u**3 - u**2,
    )
    x = h00 * p0 + h10 * hh * v0 + h01 * p1 + h11 * hh * v1
    # outside the integrated span (a sample a fraction of a frame beyond a contact time)
    for side, idx in ((rel < 0, 0), (rel > h[:, None] * STEPS, STEPS)):
        if side.any():
            st = grid[:, idx]
            kk = np.broadcast_to(np.asarray(k, float), (F,))[:, None]
            acc = -kk * np.linalg.norm(st[:, 3:], axis=1, keepdims=True) * st[:, 3:]
            acc[:, 2] += G
            dt = (rel - h[:, None] * idx)[..., None]
            ext = st[:, None, :3] + st[:, None, 3:] * dt + 0.5 * acc[:, None] * dt**2
            x = np.where(side[..., None], ext, x)
    return x


class Problem:
    def __init__(self, cam, graph, held=None, excluded=None):
        self.cam, self.g = cam, graph
        g = graph
        n_obs = len(g.obs_t)
        self.use = np.ones(n_obs, bool)
        if excluded is not None:
            self.use &= ~excluded
        if held is not None:
            self.use &= ~held
        self.sigma = SIGMA_HM * g.scale
        self.hit_nodes = [i for i, nd in enumerate(g.nodes) if nd["kind"] == "contact"]
        # open tail flights launched at an impact: receiver-half direction prior
        self.tail_nodes = [n for n in self.hit_nodes if g.flights[n]["b"] is None]

    def assign(self, T):
        """Flight index for each observation given node times."""
        g = self.g
        starts = T  # flight n starts at node n
        return np.clip(np.searchsorted(starts, g.obs_t, side="right") - 1, 0, len(g.flights) - 1)

    def spans(self, T):
        g = self.g
        end = np.array([T[fl["b"]] if fl["b"] is not None else g.t_end for fl in g.flights])
        return np.maximum(end - T[: len(g.flights)], 1e-3)

    def simulate(self, p):
        g = self.g
        k, P, T, V = g.unpack(p)
        s0 = np.concatenate([P[: len(g.flights)], V], axis=1)
        span = self.spans(T)
        grid, h = _rk4_grid(s0, span, k)
        return k, P, T, V, grid, h, span

    def residuals(self, p):
        g, cam = self.g, self.cam
        k, P, T, V, grid, h, span = self.simulate(p)
        F = len(g.flights)
        fid = self.assign(T)
        rel = (g.obs_t - T[fid])[None, :].repeat(F, 0)
        x_all = _eval(grid, h, rel, k)  # (F, n_obs, 3)
        x = x_all[fid, np.arange(len(fid))]
        uv, depth = project(cam, x)
        r_img = (uv - g.obs_px) / self.sigma
        r_img = np.where(np.isfinite(r_img), r_img, 1e3)
        r_img[~self.use] = 0.0
        r_depth = np.clip(0.5 - depth, 0, None) * 100.0
        # continuity: arriving flight end == next node
        r_cont = []
        for n, fl in enumerate(g.flights):
            if fl["b"] is not None:
                r_cont.append((grid[n, -1, :3] - P[fl["b"]]) / CONT_SD_M)
        r_cont = np.concatenate(r_cont) if r_cont else np.zeros(0)
        # contact region priors
        r_hit = []
        for n in self.hit_nodes:
            hit = g.nodes[n]["hit"]
            d = math.hypot(P[n, 0] - hit[2][0], P[n, 1] - hit[2][1])
            hgt = -P[n, 2]
            r_hit += [
                max(0.0, d - REACH_M) / REACH_SD_M,
                max(0.0, CONTACT_H_M[0] - hgt) / CONTACT_H_SD_M,
                max(0.0, hgt - CONTACT_H_M[1]) / CONTACT_H_SD_M,
                (hgt - CONTACT_H_PRIOR[0]) / CONTACT_H_PRIOR[1],
            ]
        # dense physics on the integration grid
        hgt = -grid[:, :, 2]
        r_floor = (np.clip(-hgt, 0, None) / PHYS_SD_M).ravel()
        y = grid[:, :, 1] - NET_Y_M
        cross = (
            (y[:, 1:] * y[:, :-1] < 0)
            & (grid[:, 1:, 0] >= NET_X_M[0])
            & (grid[:, 1:, 0] <= NET_X_M[1])
        )
        hc = 0.5 * (hgt[:, 1:] + hgt[:, :-1])
        r_net = np.where(cross, np.clip(NET_H_M - hc, 0, None) / PHYS_SD_M, 0.0).ravel()
        r_tail = [
            receiver_direction_residual(g.nodes[n]["hit"][2][1], V[n]) for n in self.tail_nodes
        ]
        r_drag = (
            r_tail
            + [(p[0] - math.log(DRAG_K0)) / DRAG_LOG_SD]
            + [p[fl["col"] + 3] / DRAG_FLIGHT_SD for fl in g.flights]
        )
        return np.concatenate(
            [r_img.ravel(), r_depth, r_cont, np.array(r_hit), r_floor, r_net, r_drag]
        )

    def sparsity(self):
        """Jacobian sparsity: each block depends on its flight, its two nodes and drag."""
        from scipy.sparse import lil_matrix

        g = self.g
        F = len(g.flights)
        n_obs = len(g.obs_t)

        def cols(n):
            fl = g.flights[n]
            c = [0, *range(fl["col"], fl["col"] + 4)]
            for nd in (fl["a"], fl["b"]):
                if nd is not None:
                    w = 4 if g.nodes[nd]["free_t"] else 3
                    c += range(g.nodes[nd]["col"], g.nodes[nd]["col"] + w)
            return c

        # observations near a contact may switch flights: depend on both neighbours
        tl = np.array([nd["t"] for nd in g.nodes])
        lo = np.array([nd.get("t_bounds", (nd["t"], nd["t"]))[0] for nd in g.nodes])
        hi = np.array([nd.get("t_bounds", (nd["t"], nd["t"]))[1] for nd in g.nodes])
        rows = []
        for o in range(n_obs):
            t = g.obs_t[o]
            fl = {int(np.clip(np.searchsorted(tl, t, side="right") - 1, 0, F - 1))}
            for n in range(1, len(g.nodes)):
                if lo[n] - 1e-9 <= t <= hi[n] + 1e-9:
                    fl |= {n - 1, n}
            c = sorted({q for f in fl for q in cols(f)})
            rows += [c, c]
        rows += [rows[2 * o] for o in range(n_obs)]  # depth
        for n, fl in enumerate(g.flights):
            if fl["b"] is not None:
                rows += [cols(n)] * 3
        for n in self.hit_nodes:
            c = list(range(g.nodes[n]["col"], g.nodes[n]["col"] + 3))
            rows += [c] * 4
        for _ in range(2):  # floor, net
            for n in range(F):
                rows += [cols(n)] * (STEPS + 1 if _ == 0 else STEPS)
        rows += [list(range(g.flights[n]["col"], g.flights[n]["col"] + 3)) for n in self.tail_nodes]
        rows += [[0]] + [[fl["col"] + 3] for fl in g.flights]
        m = lil_matrix((len(rows), g.n_params), dtype=int)
        for i, c in enumerate(rows):
            m[i, c] = 1
        return m

    def bounds(self):
        g = self.g
        lo = np.full(g.n_params, -np.inf)
        hi = np.full(g.n_params, np.inf)
        lo[0], hi[0] = math.log(DRAG_BOUNDS[0]), math.log(DRAG_BOUNDS[1])
        for nd in g.nodes:
            if nd["free_t"]:
                lo[nd["col"] + 3], hi[nd["col"] + 3] = nd["t_bounds"]
        for fl in g.flights:
            lo[fl["col"] + 3], hi[fl["col"] + 3] = -DRAG_FLIGHT_MAX, DRAG_FLIGHT_MAX
        return lo, hi

    def solve(self, p0, max_nfev=100):
        from scipy.optimize import least_squares

        lo, hi = self.bounds()
        p0 = np.clip(p0, lo + 1e-9, hi - 1e-9)
        return least_squares(
            self.residuals,
            p0,
            jac_sparsity=self.sparsity(),
            bounds=(lo, hi),
            method="trf",
            x_scale="jac",
            max_nfev=max_nfev,
            xtol=1e-6,
            ftol=1e-6,
        )


# ---------- initialisation ----------


def _init(cam, g):
    """Nodes from the hitter region ray; boundary node and velocities by small local fits."""
    from scipy.optimize import least_squares

    p = np.zeros(g.n_params)
    p[0] = math.log(DRAG_K0)
    for nd in g.nodes:
        if nd["kind"] == "contact":
            hit = nd["hit"]
            p[nd["col"] : nd["col"] + 3] = [hit[4][0], hit[4][1], -hit[3]]
            p[nd["col"] + 3] = nd["t"]
    # flights: velocity from node-to-node shooting + image of own samples (nodes fixed)
    prob = Problem(cam, g)
    _, _, T, _ = g.unpack(p)
    fid = prob.assign(T)
    for n, fl in enumerate(g.flights):
        sel = np.flatnonzero(fid == n)
        if not len(sel):
            continue
        ts, uv = g.obs_t[sel], g.obs_px[sel]
        nd_a = g.nodes[fl["a"]]
        b = g.nodes[fl["b"]] if fl["b"] is not None else None
        free_a = nd_a["kind"] == "clip_boundary"
        t0 = nd_a["t"]

        tail_y = nd_a["hit"][2][1] if b is None and nd_a["kind"] == "contact" else None
        flag = {"prior": True}

        def fun(q, ts=ts, uv=uv, b=b, free_a=free_a, nd_a=nd_a, t0=t0, tail_y=tail_y, flag=flag):
            x0 = q[:3] if free_a else p[nd_a["col"] : nd_a["col"] + 3]
            v = q[3:6] if free_a else q[:3]
            tend = b["t"] if b is not None else max(ts[-1], t0 + 1e-3)
            grid, h = _rk4_grid(
                np.concatenate([x0, v])[None], np.array([max(tend - t0, 1e-3)]), math.exp(p[0])
            )
            x = _eval(grid, h, (ts - t0)[None], math.exp(p[0]))[0]
            uvp, depth = project(cam, x)
            r = [((uvp - uv) / (SIGMA_HM * g.scale)).ravel(), np.clip(0.5 - depth, 0, None) * 100]
            if b is not None:
                r.append((grid[0, -1, :3] - p[b["col"] : b["col"] + 3]) / 0.05)
            r.append(np.clip(grid[0, :, 2], 0, None) / PHYS_SD_M)  # below floor (z down > 0)
            if tail_y is not None and flag["prior"]:
                r.append([receiver_direction_residual(tail_y, v)])
            r = np.concatenate(r)
            return np.where(np.isfinite(r), r, 1e3)

        best = None
        span = max((b["t"] if b is not None else ts[-1]) - t0, 0.05) if len(ts) else 0.3
        heights = (1.0, 2.5, 4.0, 6.0) if free_a else (None,)
        for h0 in heights:
            if free_a:
                xy = ray_at_height(cam, uv[0], h0) if len(uv) else None
                if xy is None:
                    continue
                x0 = np.array([xy[0], xy[1], -h0])
            else:
                x0 = p[nd_a["col"] : nd_a["col"] + 3]
            if b is not None:
                x1 = p[b["col"] : b["col"] + 3]
            else:
                x1 = x0
            ends = [x1]
            if b is None and len(uv):  # open end: several end-ray depths (both branches)
                ends = []
                for h1 in (1.0, 3.0, 6.0):
                    xy1 = ray_at_height(cam, uv[-1], h1)
                    if xy1 is not None:
                        ends.append(np.array([xy1[0], xy1[1], -h1]))
                ends = ends or [x0]
            for x1 in ends:
                v = (x1 - x0) / span
                v[2] -= 0.5 * G * span
                seeds = [v * gain for gain in (1.0, 1.6)]  # drag-slowed flights launch faster
                if tail_y is not None:  # explicit seeds in both launch directions
                    seeds += [np.array([w[0], -w[1], w[2]]) for w in seeds]
                for w in seeds:
                    q0 = np.concatenate([x0, w]) if free_a else w
                    s = least_squares(fun, q0, method="trf", max_nfev=60)
                    if best is None or s.cost < best.cost:
                        best = s
                    if tail_y is not None:  # competing launch-direction basins (image only)
                        flag["prior"] = False
                        img = fun(s.x)[: 2 * len(ts)]
                        flag["prior"] = True
                        side = (
                            "toward_receiver"
                            if receiver_direction_residual(tail_y, s.x[-3:]) == 0
                            else "away_from_receiver"
                        )
                        rms = float(np.sqrt(2 * np.mean(img**2)) * SIGMA_HM * g.scale)
                        prev = fl.setdefault("branch_rms_px", {}).get(side)
                        if prev is None or rms < prev:
                            fl["branch_rms_px"][side] = round(rms, 3)
        if best is None:
            continue
        if free_a:
            p[nd_a["col"] : nd_a["col"] + 3] = best.x[:3]
            p[fl["col"] : fl["col"] + 3] = best.x[3:6]
        else:
            p[fl["col"] : fl["col"] + 3] = best.x
    return p


# ---------- validation ----------


def _fine(state, k, span, dt=1 / 600):
    """Independent dense re-integration (RK4 at a fine fixed step, no interpolation)."""
    n = max(1, math.ceil(span / dt))
    h = span / n
    s = np.asarray(state, float)[None]
    out = [s[0]]
    for _ in range(n):
        k1 = flightfit._deriv(s, k)
        k2 = flightfit._deriv(s + 0.5 * h * k1, k)
        k3 = flightfit._deriv(s + 0.5 * h * k2, k)
        k4 = flightfit._deriv(s + h * k3, k)
        s = s + (h / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4)
        out.append(s[0])
    return np.array(out), np.linspace(0, span, n + 1)


def _validate(cam, g, p, use, fid, uv_res, held_rms, held_info=None):
    k, P, T, V = g.unpack(p)
    out = []
    for n, fl in enumerate(g.flights):
        t0 = T[n]
        tend = T[fl["b"]] if fl["b"] is not None else g.t_end
        span = max(tend - t0, 1e-3)
        xs, _ = _fine(np.concatenate([P[n], V[n]]), k[n], span)
        hgt = -xs[:, 2]
        sel = fid == n
        inl = sel & use
        rs = uv_res[sel]
        d = {
            "n_obs": int(sel.sum()),
            "n_inlier": int(inl.sum()),
            "image_rms_all_px": _r(np.sqrt(np.mean(rs**2))) if sel.any() else None,
            "image_rms_px": _r(np.sqrt(np.mean(uv_res[inl] ** 2))) if inl.any() else None,
            "image_max_inlier_px": _r(uv_res[inl].max()) if inl.any() else None,
            "holdout_rms_px": held_rms.get(n),
            **(held_info or {}).get(n, {}),
            "height_min_m": _r(hgt.min()),
            "height_max_m": _r(hgt.max()),
            "drag_k": _r(k[n], 4),
            "t0_s": _r(t0, 6),
            "duration_s": _r(span, 4),
            "state0": [_r(v, 4) for v in (*P[n], *V[n])],
        }
        if fl["b"] is not None:
            d["continuity_m"] = _r(np.linalg.norm(xs[-1, :3] - P[fl["b"]]), 4)
        y = xs[:, 1] - NET_Y_M
        crossings = [
            _r(0.5 * (hgt[i] + hgt[i + 1]))
            for i in np.flatnonzero(y[1:] * y[:-1] < 0)
            if NET_X_M[0] <= xs[i, 0] <= NET_X_M[1]
        ]
        d["net_crossing_heights_m"] = crossings
        reason = None
        sc = g.scale
        if d.get("continuity_m", 0) > CRITERIA["J1_continuity_m"]:
            reason = "J1_continuity"
        elif (
            d["n_inlier"] < MIN_FLIGHT_OBS
            or d["n_inlier"] < CRITERIA["J2_min_inlier_fraction"] * d["n_obs"]
        ):
            reason = "J2_inliers"
        elif d["image_rms_px"] > CRITERIA["J2_inlier_rms_hm"] * sc:
            reason = "J2_image_rms"
        elif (held_info or {}).get(n, {}).get("n_eval", 0) > 0 and (
            d["holdout_rms_px"] is None
            or d["holdout_rms_px"] > CRITERIA["J3_holdout_rms_hm"] * sc
            or held_info[n]["eval_inlier_fraction"] < CRITERIA["J3_min_inlier_fraction"]
        ):
            reason = "J3_holdout"
        elif hgt.min() < CRITERIA["J4_height_m"][0] or hgt.max() > CRITERIA["J4_height_m"][1]:
            reason = "J4_height"
        elif any(c < NET_H_M - CRITERIA["J4_net_tol_m"] for c in crossings):
            reason = "J4_net"
        elif (project(cam, xs[:, :3])[1] <= 0).any():
            reason = "J4_behind_camera"
        else:
            x0, x1, y0, y1 = SURROUND
            if (
                (xs[:, 0] < x0).any()
                or (xs[:, 0] > x1).any()
                or (xs[:, 1] < y0).any()
                or (xs[:, 1] > y1).any()
            ):
                reason = "J5_surround"
        d["accepted"] = reason is None
        d["reason"] = reason
        out.append(d)
    return out


def _r(v, nd=3):
    v = float(v)
    return round(v, nd) if math.isfinite(v) else None


# ---------- builder ----------


def _unavailable(n, note):
    return {"status": "unavailable", "method": METHOD, "note": note}, [None] * n


def _fit_run(cam, run, contacts, tc, px, scale, info):
    g = Graph(run, contacts, tc, px, scale)
    p0 = _init(cam, g)
    excluded = np.zeros(len(g.obs_t), bool)
    nfev = 0
    sol = None
    for _ in range(3):  # robust re-weighting: exclude gross residuals, refit
        prob = Problem(cam, g, excluded=excluded)
        sol = prob.solve(p0 if sol is None else sol.x)
        nfev += sol.nfev
        res = _img_res(prob, sol.x)
        new = res > OUTLIER_HM * scale
        if (new == excluded).all():
            break
        excluded = new
    p = sol.x
    # Selection diagnostics use training data and physics only (J1, J2, J4, J5): the
    # J3 uses a locked evaluation partition never seen here (_evaluate_frozen).
    flights = _train_diag(cam, g, p, excluded)
    info["nfev"] = info.get("nfev", 0) + nfev
    info["n_params"] = info.get("n_params", 0) + g.n_params
    info["n_residuals"] = info.get("n_residuals", 0) + len(sol.fun)
    info["cost"] = _r(info.get("cost", 0.0) + float(sol.cost), 3)
    return g, p, flights, excluded, None, None, None


def _train_diag(cam, g, p, excluded):
    """Training-only flight diagnostics for model selection: fitted (non-held-out) image
    residuals and physical checks; no held-out refit, so J3 never enters selection."""
    prob = Problem(cam, g, excluded=excluded)
    res = _img_res(prob, p)
    _, _, T, _ = g.unpack(p)
    return _validate(cam, g, p, ~excluded, prob.assign(T), res, {})


def _evaluate_frozen(cam, g, p, excluded, frames, skip, tc, px, scale):
    """J3 on the locked evaluation frames: the FROZEN training-selected model is integrated
    and projected at each frame's capture time and compared with the withheld raw pixel. No
    refit, no decision feeds back. Returns (final flight diagnostics, scored, gross)."""
    k, P, T, V = g.unpack(p)
    prob = Problem(cam, g, excluded=excluded)
    res = _img_res(prob, p)
    fid = prob.assign(T)
    F = len(g.flights)
    per, scored, gross = {}, [], set()
    thr = OUTLIER_HM * scale
    for i in frames:
        if i in skip:  # a repeated source frame duplicates a neighbour's image: not independent
            continue
        t = tc[i]
        fn = int(np.clip(np.searchsorted(T[:F], t, side="right") - 1, 0, F - 1))
        tend = T[g.flights[fn]["b"]] if g.flights[fn]["b"] is not None else g.t_end
        if t < T[fn] - 1e-6 or t > tend + 1e-6:
            continue
        x = flightfit.simulate(np.concatenate([P[fn], V[fn]])[None], [0.0, t - T[fn]], k[fn])
        uv, depth = project(cam, x[0][-1])
        r = float(np.linalg.norm(uv - np.asarray(px[i], float)))
        r = r if math.isfinite(r) and depth > 0 else 1e6
        per.setdefault(fn, []).append(r)
        scored.append(i)
        if r > thr:
            gross.add(i)
    held_rms, held_info = {}, {}
    for fn, rs in per.items():
        rs = np.array(rs)
        inl = rs[rs <= thr]
        held_rms[fn] = _r(np.sqrt(np.mean(inl**2))) if len(inl) else None
        held_info[fn] = {
            "n_eval": len(rs),
            "n_eval_gross": int((rs > thr).sum()),
            "eval_inlier_fraction": _r(len(inl) / len(rs)),
            "eval_rms_all_px": _r(np.sqrt(np.mean(np.minimum(rs, 1e3) ** 2))),
        }
    for fn in range(F):
        held_info.setdefault(fn, {"n_eval": 0})
    flights = _validate(cam, g, p, ~excluded, fid, res, held_rms, held_info=held_info)
    return flights, scored, gross


class _Deadline(Exception):
    pass


def local_multistart(cam, g, p, fl_diag, excluded, info, budget_s=None, clock=time.monotonic):
    """Bounded local multistart on the graph block of each flight failing J1-J3.

    Block = the flight's impact node(s) and every flight sharing them (shared nodes stay
    shared; only velocities change at a contact). Starts move each impact node along its
    own current pixel ray to LOCAL_HEIGHTS_M and its time within its bounds; each start
    solves the block's residual rows (image, continuity, contact priors, floor/net, drag)
    with all other parameters fixed. The lowest block cost wins if it beats the current
    one; then a short whole-graph polish and J1-J5 revalidation. The new state is kept
    only if no fewer observations pass. All decisions use training residuals and physics
    (fl_diag must come from _train_diag), never the held-out evaluation.

    Cooperative wall budget on a monotonic clock: checked before every start, before the
    polish and inside every residual evaluation; on exhaustion no new start or polish is
    launched and the last validated state (p, fl_diag) is returned unchanged. The service's
    outer subprocess kill remains the hard stop. Returns (p, flight diagnostics, log)."""
    import itertools

    from scipy.optimize import least_squares

    budget_s = LOCAL_BUDGET_S if budget_s is None else budget_s
    started = clock()
    deadline = started + budget_s

    def exhausted(where):
        if clock() > deadline:
            log.append(
                {
                    "step": "local_multistart_budget_exhausted",
                    "at": where,
                    "returned": "last validated state (input)",
                }
            )
            info["local_multistart_budget_exhausted"] = True
            return True
        return False

    log = []
    prob = Problem(cam, g, excluded=excluded)
    S = prob.sparsity().tocsc()
    lo, hi = prob.bounds()
    failing = [
        n
        for n, d in enumerate(fl_diag)
        if not d["accepted"] and str(d["reason"])[:2] in ("J1", "J2", "J3")
    ]
    failing.sort(key=lambda n: -(fl_diag[n]["image_rms_px"] or 0.0))
    p_new = p.copy()
    changed = False
    for n in failing:
        if exhausted(f"before block of flight {n}"):
            return p, fl_diag, log
        nodes = [
            m for m in (n, g.flights[n]["b"]) if m is not None and g.nodes[m]["kind"] == "contact"
        ]
        if not nodes:
            continue
        flights = sorted({n} | {m - 1 for m in nodes} | {m for m in nodes if m < len(g.flights)})
        cols = []
        for m in nodes:
            cols += range(g.nodes[m]["col"], g.nodes[m]["col"] + (4 if g.nodes[m]["free_t"] else 3))
        for f in flights:
            cols += range(g.flights[f]["col"], g.flights[f]["col"] + 4)
        cols = np.array(cols)
        rows = np.unique(S[:, cols].nonzero()[0])
        sub = S[rows][:, cols]
        ref = p_new.copy()

        def fun(q, ref=ref, cols=cols, rows=rows):
            if clock() > deadline:
                raise _Deadline
            pp = ref.copy()
            pp[cols] = q
            return prob.residuals(pp)[rows]

        try:
            base = 0.5 * float(np.sum(fun(ref[cols]) ** 2))
        except _Deadline:
            exhausted(f"block of flight {n}")
            return p, fl_diag, log
        _, P, _, _ = g.unpack(ref)
        best, starts = None, 0
        for hh, tf in itertools.product(
            itertools.product(LOCAL_HEIGHTS_M, repeat=len(nodes)), (None, LOCAL_TIME_FRACTION)
        ):
            if exhausted(f"before start {starts} of flight {n}"):
                return p, fl_diag, log
            log.append(
                {
                    "step": "local_start",
                    "flight": n,
                    "start": starts,
                    "started_at": _r(clock() - started, 3),
                }
            )
            p0 = ref.copy()
            for m, h in zip(nodes, hh, strict=True):
                uv, _ = project(cam, P[m])
                xy = ray_at_height(cam, uv, h)  # same pixel, another depth
                if xy is not None:
                    p0[g.nodes[m]["col"] : g.nodes[m]["col"] + 3] = [xy[0], xy[1], -h]
                if tf is not None and g.nodes[m]["free_t"]:
                    a, b = g.nodes[m]["t_bounds"]
                    p0[g.nodes[m]["col"] + 3] = a + tf * (b - a)
            q0 = np.clip(p0[cols], lo[cols] + 1e-9, hi[cols] - 1e-9)
            try:
                finite0 = bool(np.isfinite(fun(q0)).all())
            except _Deadline:
                exhausted(f"inside start {starts} of flight {n}")
                return p, fl_diag, log
            if not finite0:  # this seed diverges (RK4 overflow): skip it, keep other starts
                log.append(
                    {
                        "step": "local_start_skipped_nonfinite",
                        "flight": n,
                        "completed_starts_before": starts,
                        "node_heights_m": list(hh),
                        "time_fraction": tf,
                    }
                )
                info["local_starts_skipped_nonfinite"] = (
                    info.get("local_starts_skipped_nonfinite", 0) + 1
                )
                continue
            try:
                sol = least_squares(
                    fun,
                    q0,
                    jac_sparsity=sub,
                    bounds=(lo[cols], hi[cols]),
                    method="trf",
                    x_scale="jac",
                    max_nfev=LOCAL_NFEV,
                )
            except _Deadline:  # a slow solve ran past the deadline: discard everything
                exhausted(f"inside start {starts} of flight {n}")
                return p, fl_diag, log
            starts += 1
            if best is None or sol.cost < best.cost:
                best = sol
        kept = best is not None and best.cost < base - 1e-6
        log.append(
            {
                "step": "local_multistart",
                "flight": n,
                "node_frames": [g.nodes[m]["frame"] for m in nodes],
                "starts": starts,
                "previous_block_cost": _r(base),
                "block_cost": _r(best.cost) if best else None,
                "kept": bool(kept),
            }
        )
        if kept:
            p_new[cols] = best.x
            changed = True
    if not changed:
        return p, fl_diag, log
    if exhausted("before polish"):
        return p, fl_diag, log

    def gfun(q):
        if clock() > deadline:
            raise _Deadline
        return prob.residuals(q)

    try:  # short whole-graph polish
        sol = least_squares(
            gfun,
            np.clip(p_new, lo + 1e-9, hi - 1e-9),
            jac_sparsity=S,
            bounds=(lo, hi),
            method="trf",
            x_scale="jac",
            max_nfev=LOCAL_POLISH_NFEV,
            xtol=1e-6,
            ftol=1e-6,
        )
    except _Deadline:
        exhausted("inside polish")
        return p, fl_diag, log
    cost_new = 0.5 * float(np.sum(prob.residuals(p_new) ** 2))
    if sol.cost < cost_new:
        p_new = sol.x
    # keep decision: training objective + training/physical checks only (no held-out)
    cost_old = 0.5 * float(np.sum(prob.residuals(p) ** 2))
    fl_new = _train_diag(cam, g, p_new, excluded)
    ok = bool(_coverage(fl_new) >= _coverage(fl_diag) and min(sol.cost, cost_new) < cost_old)
    log.append(
        {
            "step": "local_multistart_polish",
            "graph_cost": _r(min(sol.cost, cost_new)),
            "previous_graph_cost": _r(cost_old),
            "coverage": _coverage(fl_new),
            "previous_coverage": _coverage(fl_diag),
            "kept": ok,
        }
    )
    info["elapsed_local_multistart_s"] = _r(clock() - started, 2)
    return (p_new, fl_new, log) if ok else (p, fl_diag, log)


def _coverage(fl_diag):
    """Model-selection score: observations explained by flights passing the TRAINING checks
    (J1, J2, J4, J5 of _train_diag); held-out J3 is never part of selection."""
    return sum(f["n_inlier"] for f in fl_diag if f["accepted"])


def _fit_graph(cam, run, tc, px, players, scale, info, structural=frozenset()):
    """Contacts, robust exclusions and the joint fit. A change of the contact graph is kept
    only if it does not reduce the observations explained by flights passing J1-J5:
    (1) contacts are re-detected once without excluded observations (a rejected block must
    not fake or hide a contact) when exclusions are few; (2) a fitted contact without an
    impulse (< MIN_IMPULSE_MS) is removed and the graph refitted."""
    log = []

    def attempt(contacts):
        g, p, fl_diag, excluded, *_ = _fit_run(cam, run, contacts, tc, px, scale, info)
        return {
            "contacts": contacts,
            "g": g,
            "p": p,
            "fl": fl_diag,
            "excl": excluded,
            "score": _coverage(fl_diag),
        }

    contacts, n_scored = find_contacts(cam, px, tc, run, players, scale, structural=structural)
    info["candidates_scored"] += n_scored
    best = attempt(contacts)
    excl = {best["g"].obs_frame[o] for o in np.flatnonzero(best["excl"])}
    if excl and len(excl) <= REDETECT_MAX_FRACTION * len(run):
        det = [i for i in run if i not in excl]
        again, n_scored = find_contacts(cam, px, tc, det, players, scale, excl, structural)
        info["candidates_scored"] += n_scored
        if [c["frame"] for c in again] != [c["frame"] for c in contacts]:
            alt = attempt(again)
            log.append(
                {
                    "step": "redetect_without_exclusions",
                    "score": alt["score"],
                    "previous": best["score"],
                    "kept": alt["score"] >= best["score"],
                }
            )
            if alt["score"] >= best["score"]:
                best = alt
    # (2) contact-graph merge: consecutive same-player contacts (singles needs an opponent
    # hit in between) or a contact far beyond the soft reach prior. A physically impossible
    # sequence is merged unless coverage drops by more than MERGE_TOLERANCE; an unreachable
    # contact alone only if coverage does not drop.
    tested = set()
    for _ in range(MAX_DROPS):
        recs = _node_records(best["g"], best["p"])
        cands = [f for f in merge_candidates(recs) if f not in tested]
        if not cands:
            break
        frame = cands[0]
        tested.add(frame)
        hits = [r for r in recs if r["kind"] == "contact"]
        same = any(
            a["player"] == b["player"] and frame in (a["frame"], b["frame"])
            for a, b in zip(hits, hits[1:], strict=False)
        )
        alt = attempt([c for c in best["contacts"] if c["frame"] != frame])
        floor = best["score"] * (1 - MERGE_TOLERANCE) if same else best["score"]
        ok = alt["score"] >= floor
        log.append(
            {
                "step": "merge_inconsistent_contact",
                "frame": frame,
                "reason": "consecutive_same_player" if same else "beyond_reach_prior",
                "score": alt["score"],
                "previous": best["score"],
                "kept": ok,
            }
        )
        if ok:
            best = alt
    keep = set()
    for _ in range(MAX_DROPS):
        dv = impulses(cam, best["g"], best["p"])
        weak = [m for m in dv if dv[m] < MIN_IMPULSE_MS and best["g"].nodes[m]["frame"] not in keep]
        if not weak:
            break
        m = min(weak, key=lambda q: dv[q])  # model selection: no impulse, no contact
        frame = best["g"].nodes[m]["frame"]
        alt = attempt([c for c in best["contacts"] if c["frame"] != frame])
        ok = alt["score"] >= best["score"]
        log.append(
            {
                "step": "remove_contact_without_impulse",
                "frame": frame,
                "impulse_m_s": _r(dv[m]),
                "score": alt["score"],
                "previous": best["score"],
                "kept": ok,
            }
        )
        if ok:
            best = alt
        else:
            keep.add(frame)
    # (3) a flight failing the image criteria may be an artefact of a false contact: try the
    # graph without one bounding contact (weakest impulse first); keep only if coverage grows.
    tried = set()
    for _ in range(REPAIR_ATTEMPTS):
        g = best["g"]
        dv = impulses(cam, g, best["p"])
        cand = []
        for n, (fl, d) in enumerate(zip(g.flights, best["fl"], strict=True)):
            if d["accepted"] or not str(d["reason"]).startswith("J2"):
                continue
            for m in (n, fl["b"]):
                if m is not None and g.nodes[m]["kind"] == "contact":
                    cand.append((dv[m], g.nodes[m]["frame"]))
        cand = sorted(c for c in cand if c[1] not in tried)
        if not cand:
            break
        imp, frame = cand[0]
        tried.add(frame)
        alt = attempt([c for c in best["contacts"] if c["frame"] != frame])
        ok = alt["score"] > best["score"]
        log.append(
            {
                "step": "remove_contact_next_to_failing_flight",
                "frame": frame,
                "impulse_m_s": _r(imp),
                "score": alt["score"],
                "previous": best["score"],
                "kept": ok,
            }
        )
        if ok:
            best = alt
    # (4) bounded local multistart + polish on blocks of still-failing flights
    if any(not f["accepted"] for f in best["fl"]):
        best["p"], best["fl"], mlog = local_multistart(
            cam, best["g"], best["p"], best["fl"], best["excl"], info
        )
        log.extend(mlog)
    return best["g"], best["p"], best["fl"], best["excl"], log


def _node_records(g, p):
    """Fitted contact player/reach summary for model selection."""
    _, P, _, _ = g.unpack(p)
    out = []
    for m, nd in enumerate(g.nodes):
        rec = {"kind": nd["kind"], "frame": nd["frame"]}
        if nd["kind"] == "contact":
            hit = nd["hit"]
            rec["player"] = hit[1]
            rec["reach_distance_m"] = math.hypot(P[m, 0] - hit[2][0], P[m, 1] - hit[2][1])
        out.append(rec)
    return out


def impulses(cam, g, p):
    """|velocity change| (m/s) at each contact node of a fitted graph."""
    k, P, T, V, grid, h, span = Problem(cam, g).simulate(p)
    return {
        m: float(np.linalg.norm(V[m] - grid[m - 1, -1, 3:]))
        for m, nd in enumerate(g.nodes)
        if nd["kind"] == "contact"
    }


def _img_res(prob, p):
    g = prob.g
    k, P, T, V, grid, h, span = prob.simulate(p)
    F = len(g.flights)
    fid = prob.assign(T)
    rel = (g.obs_t - T[fid])[None, :].repeat(F, 0)
    x = _eval(grid, h, rel, k)[fid, np.arange(len(fid))]
    uv, _ = project(prob.cam, x)
    r = np.linalg.norm(uv - g.obs_px, axis=1)
    return np.where(np.isfinite(r), r, 1e6)


def build_joint_reference(
    pts, shuttle_px, segments, calibrated_segment, cam, *, reason=None, players=None
):
    """(top-level metadata, per-frame refs or None). Never alters shuttle_px."""
    n = len(pts)
    if cam is None:
        return _unavailable(n, f"No conditional shuttle reference: {reason or 'no camera'}.")
    if calibrated_segment is None or not 0 <= calibrated_segment < len(segments):
        return _unavailable(n, "No conditional shuttle reference: no calibrated camera segment.")
    started = time.monotonic()
    a, b = segments[calibrated_segment]
    eval_frames = {i for i in range(a, b) if i % EVAL_EVERY == EVAL_PHASE}  # locked first
    observed_all = [i for i in range(a, b) if shuttle_px[i] is not None]
    eval_obs = [i for i in observed_all if i in eval_frames]
    observed = [i for i in observed_all if i not in eval_frames]  # TRAINING observations
    if not observed:
        return _unavailable(n, "No conditional shuttle reference: no shuttle observation.")
    scale = px_scale(cam)
    tc, repeats, cadence = capture_times(pts, shuttle_px, observed)  # training pixels only
    eval_repeat = (
        {i for i in eval_obs if i >= 1 and i % cadence["period_frames"] == cadence["repeat_phase"]}
        if cadence
        else set()
    )
    eval_scored, eval_gross, fit_inputs = [], set(), set()
    # known sampling holes (mask + repeat cadence from training pixels): not detector gaps
    structural = frozenset(
        eval_frames
        | (
            {
                i
                for i in range(a, b)
                if i >= 1 and i % cadence["period_frames"] == cadence["repeat_phase"]
            }
            if cadence
            else set()
        )
    )
    fit_obs = [i for i in observed if i not in repeats]
    rejected = flightfit._spikes(shuttle_px, fit_obs, flightfit.SPIKE_HM * scale)
    rejected |= flightfit._continuation_outliers(
        shuttle_px,
        list(tc),
        [i for i in fit_obs if i not in rejected],
        flightfit.OUTLIER_HM * scale,
    )
    clean = [i for i in fit_obs if i not in rejected]
    runs, cur = [], []
    for i in clean:
        if cur and tc[i] - tc[cur[-1]] > MAX_BRIDGE_S:
            runs.append(cur)
            cur = []
        cur.append(i)
    if cur:
        runs.append(cur)
    refs = [None] * n
    flights_out, nodes_out = [], []
    info = {
        "joint": True,
        "solver": "scipy.optimize.least_squares trf, sparse 2-point Jacobian",
        "selection_boundary": (
            f"evaluation frames (source index % {EVAL_EVERY} == {EVAL_PHASE}) are locked before "
            "any trajectory processing; cadence, outliers, contacts, graph selection, "
            "initialisation, fitting, local multistart and polish use TRAINING pixels only "
            "(J1, J2, J4, J5 on training data); J3 projects the frozen selected model at the "
            "evaluation capture times (no refit) and only decides display eligibility"
        ),
        "steps_per_flight": STEPS,
        "runs": 0,
        "candidates_scored": 0,
    }
    for run in runs:
        if len(run) < 2 * MIN_FLIGHT_OBS:
            rejected.update(run)
            continue
        info["runs"] += 1
        g, p, fl_diag, excluded, dropped = _fit_graph(
            cam, run, tc, shuttle_px, players, scale, info, structural
        )
        info.setdefault("model_selection", []).extend(dropped)
        # Selection is final here (training pixels only). J3: the frozen model is evaluated
        # directly on the locked evaluation pixels; it only decides display eligibility.
        fl_diag, sc_, gr_ = _evaluate_frozen(
            cam,
            g,
            p,
            excluded,
            [i for i in eval_obs if run[0] <= i <= run[-1]],
            eval_repeat,
            tc,
            shuttle_px,
            scale,
        )
        eval_scored += sc_
        eval_gross |= gr_
        fit_inputs |= {g.obs_frame[o] for o in np.flatnonzero(~excluded)}
        rejected.update(g.obs_frame[o] for o in np.flatnonzero(excluded))
        k, P, T, V = g.unpack(p)
        node_ids = []
        for m, nd in enumerate(g.nodes):
            nid = f"auto_c{len(nodes_out) + 1}"
            node_ids.append(nid)
            rec = {
                "node_id": nid,
                "kind": nd["kind"],
                "t_s": _r(T[m], 6),
                "xyz_m": [_r(P[m, 0]), _r(P[m, 1]), _r(-P[m, 2])],
                "frame": nd["frame"],
            }
            if nd["kind"] == "contact":
                hit = nd["hit"]
                rec.update(
                    {
                        "status": "inferred",
                        "t_bounds_s": [_r(nd["t_bounds"][0], 6), _r(nd["t_bounds"][1], 6)],
                        "frame_bounds": nd["frames"],
                        "player": hit[1],
                        "player_ground_xy_m": [_r(v) for v in hit[2]],
                        "reach_prior": {
                            "kind": "soft hinge",
                            "nominal_m": REACH_M,
                            "sd_m": REACH_SD_M,
                        },
                        "height_prior": {
                            "kind": "soft hinge band",
                            "band_m": list(CONTACT_H_M),
                            "sd_m": CONTACT_H_SD_M,
                        },
                        "reach_distance_m": _r(
                            math.hypot(P[m, 0] - hit[2][0], P[m, 1] - hit[2][1])
                        ),
                    }
                )
                # Soft priors: report the actual deviation instead of claiming "inside".
                rec["outside_reach_nominal_m"] = _r(max(0.0, rec["reach_distance_m"] - REACH_M))
                hgt = rec["xyz_m"][2]
                rec["outside_height_band_m"] = _r(
                    max(0.0, CONTACT_H_M[0] - hgt, hgt - CONTACT_H_M[1])
                )
            else:
                rec["status"] = "free_boundary"
            nodes_out.append(rec)
        ids = []
        assigned = Problem(cam, g).assign(T)
        for fn, (fl, d) in enumerate(zip(g.flights, fl_diag, strict=True)):
            fid_s = f"auto_j{len(flights_out) + 1}"
            ids.append(fid_s)
            sel = [g.obs_frame[o] for o in range(len(g.obs_t)) if assigned[o] == fn]
            d.update(
                {
                    "flight_id": fid_s,
                    "frames": [min(sel), max(sel)] if sel else None,
                    "start_node": node_ids[fl["a"]],
                    "end_node": node_ids[fl["b"]] if fl["b"] is not None else None,
                    "sporting_speed_kmh": None,
                    "provenance": "joint MAP of the contact graph (conditional, not measured)",
                    "branch_rms_px": fl.get("branch_rms_px"),
                }
            )
            flights_out.append(d)
        # per-frame display: model position at each frame's capture time inside its flight
        first, last = run[0], run[-1]
        for i in range(first, last + 1):
            if i in rejected or i in eval_gross:
                continue
            t = tc[i]
            fn = int(
                np.clip(
                    np.searchsorted(T[: len(g.flights)], t, side="right") - 1, 0, len(g.flights) - 1
                )
            )
            d = fl_diag[fn]
            if not d["accepted"]:
                continue
            tend = T[g.flights[fn]["b"]] if g.flights[fn]["b"] is not None else g.t_end
            xs = flightfit.simulate(
                np.concatenate([P[fn], V[fn]])[None], [0.0, max(t - T[fn], 0.0)], k[fn]
            )[0][-1]
            if t > tend + 1e-6:
                continue
            xy = [_r(xs[0]), _r(xs[1])]
            refs[i] = {
                "status": "estimated" if shuttle_px[i] is not None else "interpolated",
                "xy_m": xy,
                "xyz_m": [*xy, _r(-xs[2])],
                "flight_id": ids[fn],
                "model_capture_time_s": _r(t, 6),
                "repeated_source_frame": i in repeats or i in eval_repeat,
                "evaluation_frame": i in eval_frames,
                "fit_input": i in fit_inputs,
                "reference_frame_id": None,
                "reference_pts_s": None,
            }
    training_rejected = sorted(rejected)
    for i in rejected | eval_gross:
        refs[i] = None
    info["elapsed_s"] = _r(time.monotonic() - started, 2)
    partition = {
        "rule": f"source frame index % {EVAL_EVERY} == {EVAL_PHASE}, locked before any "
        "trajectory-dependent processing",
        "every": EVAL_EVERY,
        "phase": EVAL_PHASE,
        "n_evaluation_frames": len(eval_frames),
        "n_evaluation_observed": len(eval_obs),
        "n_evaluation_repeat_excluded": len(eval_repeat),
        "n_evaluation_scored": len(eval_scored),
        "n_evaluation_gross": len(eval_gross),
        "n_training_observed": len(observed),
        "n_fit_inputs": len(fit_inputs),
        "training_rejected": training_rejected,
        "evaluation_gross_frames": sorted(eval_gross),
        "independence": (
            "conditional on the automatic camera, selected players, PTS and the disclosed "
            "repeat-cadence hypothesis; TrackNet's 3-frame input windows correlate "
            "neighbouring detections; a repeated source frame is never scored"
        ),
    }
    accepted = [f for f in flights_out if f["accepted"]]
    if not accepted:
        top, _ = _unavailable(n, "No conditional shuttle reference: no joint flight passed J1-J5.")
        extra = {"flights": flights_out, "contacts": nodes_out, "solver": info}
        extra.update({"capture_cadence": cadence, "evaluation_partition": partition})
        return top | extra, [None] * n
    counts = {
        s: sum(1 for r in refs if r and r["status"] == s) for s in ("estimated", "interpolated")
    }
    counts.update(
        {
            "rejected": len(rejected),
            "repeated_frames_excluded_from_fit": len(repeats),
            "none": sum(1 for r in refs if r is None),
            "flights_accepted": len(accepted),
            "flights_rejected": len(flights_out) - len(accepted),
            "contacts": sum(1 for c in nodes_out if c["kind"] == "contact"),
        }
    )
    centre = cam["centre_m"]
    ks = [f["drag_k"] for f in flights_out]
    ks = [min(ks), max(ks)] if ks else None
    top = {
        "status": "conditional_reference",
        "method": (
            f"{METHOD}: joint contact-to-contact flight graph (shared impact nodes, gravity + "
            "quadratic drag) fitted to TrackNet pixels at capture times through a camera inferred "
            "from the automatic floor homography"
        ),
        "note": (
            "Display-only conditional best hypothesis, NOT a measurement. Impacts are shared "
            "model nodes inferred automatically; estimated/interpolated = joint-model position "
            "at an observed / detector-null frame. Rejected observations and flights failing "
            "J1-J5 show nothing. Raw observations are unchanged; no speeds are published."
        ),
        "assumptions": [
            f"Gravity {G} m/s^2; quadratic drag fitted hierarchically: a global constant per run "
            f"within {list(DRAG_BOUNDS)} 1/m under a log-normal prior centred {DRAG_K0} (log sd "
            f"{DRAG_LOG_SD}), times a per-flight factor exp(d), d ~ N(0, {DRAG_FLIGHT_SD}) bounded "
            f"+-{DRAG_FLIGHT_MAX}.",
            "A contact changes velocity, not position: each flight starts at the shared impact "
            f"node the previous flight must reach (sd {CONT_SD_M} m).",
            f"SOFT priors (hinges, not hard bounds) pull impact nodes within {REACH_M} m "
            f"(sd {REACH_SD_M}) of the selected hitter's pose ground point and into "
            f"{CONTACT_H_M[0]}-{CONTACT_H_M[1]} m height (sd {CONTACT_H_SD_M}; weak height prior "
            f"{CONTACT_H_PRIOR[0]}+-{CONTACT_H_PRIOR[1]} m); each contact reports its actual "
            "outside_reach_nominal_m / outside_height_band_m. Contact times are bounded by the "
            "neighbouring samples and are not reviewed. Consecutive same-player contacts or "
            "contacts far beyond reach are merge-tested.",
            "An open last flight launched at an impact gets a soft receiver-half direction prior "
            f"(sd {RECEIVER_SD_M_S} m/s of launch away from the net); both launch directions are "
            "seeded and their image-only RMS is reported per flight (branch_rms_px).",
            f"Image noise sd {SIGMA_HM} TrackNet heatmap px; residuals over {OUTLIER_HM} "
            "heatmap px are excluded and reported.",
            "The first flight of a run starts at a free boundary node at its first observation; "
            "no receiver contact is forced at clip or gap edges.",
            "Camera: principal point at the image centre, square pixels, zero skew; focal length "
            f"{cam['focal_px']:.0f} px and centre ({centre[0]:.1f}, {centre[1]:.1f}) m at "
            f"{centre[2]:.1f} m height derived from the automatic floor homography, not surveyed.",
            "Monocular depth comes from gravity/drag curvature, contact regions and continuity; "
            "it is a conditional best hypothesis, not independently validated depth.",
        ],
        "coordinate_system": {
            "x_m": "0..6.1 across, x=0 image-left doubles sideline",
            "y_m": "0 FAR end .. 13.4 NEAR camera end; net y=6.7",
            "z_m": "xyz_m[2] = model height above the floor (conditional); fit uses z down",
            "bounds": "not clipped; off-court values are kept",
        },
        "camera": {
            "focal_px": round(cam["focal_px"], 2),
            "principal_point_px": cam["principal_point_px"],
            "centre_m": [round(v, 3) for v in centre],
            "checks": cam["checks"],
        },
        "capture_cadence": cadence,
        "evaluation_partition": partition,
        "time_provenance": {
            "retimed": cadence is not None,
            "pts_unchanged": True,
            "per_frame_field": "shuttle_map_reference.model_capture_time_s",
            "rule": (cadence or {}).get("rule", "model_capture_time_s = pts_s (no retime)"),
            "cfr_tolerance": CFR_TOL,
        },
        "criteria": {k: (list(v) if isinstance(v, tuple) else v) for k, v in CRITERIA.items()},
        "thresholds": {
            "sigma_px": SIGMA_HM * scale,
            "outlier_px": OUTLIER_HM * scale,
            "source_px_per_heatmap_px": round(scale, 3),
            "jump_rel": JUMP_REL,
            "jump_min_px_s": JUMP_MIN_HM_S * scale,
            "hitter_box_reach": [REACH_BOX_W, REACH_BOX_UP, REACH_BOX_DOWN],
            "max_bridge_s": MAX_BRIDGE_S,
            "drag_bounds": list(DRAG_BOUNDS),
            "net_height_m": NET_H_M,
        },
        "drag_k_range_fitted": ks,
        "segment_id": f"s{calibrated_segment}",
        "counts": counts,
        "solver": info,
        "contacts": nodes_out,
        "flights": flights_out,
    }
    return top, refs
