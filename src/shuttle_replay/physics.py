# SPDX-License-Identifier: AGPL-3.0-only
"""Gravity + quadratic-drag shuttle flight model.

State: position (m), velocity (m/s); drag acceleration is -k * |v| * v with a
per-flight coefficient k (1/m). Parameters: [x, y, z, vx, vy, vz, k]. Time is
seconds since the reviewed contact (flight time zero), not since the first
observed detection.
"""

import numpy as np
from scipy.integrate import solve_ivp

from .court import NET_CENTRE_HEIGHT_M, NET_Y_M


def _rhs(k, gravity):
    def rhs(_, s):
        v = s[3:]
        a = -k * np.linalg.norm(v) * v
        a[2] -= gravity
        return np.r_[v, a]

    return rhs


def simulate(params, t, gravity=9.81):
    """Positions at flight times t (seconds since contact, must be >= 0)."""
    p = np.asarray(params, float)
    ts = np.atleast_1d(np.asarray(t, float))
    if len(ts) == 0:
        return np.empty((0, 3))
    if np.any(ts < -1e-9) or not np.all(np.isfinite(ts)):
        raise ValueError("flight time must be finite and nonnegative")
    end = max(float(ts.max()), 1e-7)
    sol = solve_ivp(
        _rhs(p[6], gravity), [0, end], p[:6], rtol=1e-7, atol=1e-8, dense_output=True, max_step=0.02
    )
    if not sol.success:
        raise ValueError(sol.message)
    return sol.sol(np.clip(ts, 0, None)).T[:, :3]


def floor_crossing(params, gravity=9.81, horizon_s=10.0):
    """First descending Z=0 crossing as (time_since_contact, xyz), or None."""
    p = np.asarray(params, float)

    def event(_, s):
        return s[2]

    event.direction = -1
    event.terminal = True
    sol = solve_ivp(
        _rhs(p[6], gravity),
        [0, horizon_s],
        p[:6],
        events=event,
        rtol=1e-9,
        atol=1e-10,
        max_step=0.01,
    )
    if not len(sol.t_events[0]):
        return None
    return float(sol.t_events[0][0]), sol.y_events[0][0, :3]


def net_crossing_height(path):
    """Interpolated height where a sampled path first crosses the net plane."""
    path = np.asarray(path, float)
    y = path[:, 1] - NET_Y_M
    hits = np.flatnonzero(y[:-1] * y[1:] <= 0)
    if not len(hits):
        return None
    i = int(hits[0])
    w = -y[i] / (y[i + 1] - y[i] + 1e-12)
    return float(path[i, 2] * (1 - w) + path[i + 1, 2] * w)


def _net_crossing_heights(path):
    y = path[:, 1] - NET_Y_M
    hits = np.flatnonzero(y[:-1] * y[1:] <= 0)
    out = []
    for i in hits:
        w = -y[i] / (y[i + 1] - y[i] + 1e-12)
        out.append(float(path[i, 2] * (1 - w) + path[i + 1, 2] * w))
    return out


def physical_gates(path, crosses_net, floor_tol_m=0.02, net_height_m=NET_CENTRE_HEIGHT_M):
    """Floor and net feasibility of a sampled path.

    ``crosses_net`` is the expected crossing from the reviewed endpoints. Any actual
    crossing of the net plane below net height fails, whether or not it was expected.
    """
    path = np.asarray(path, float)
    heights = _net_crossing_heights(path)
    occurred = bool(heights)
    floor_ok = bool(path[:, 2].min() >= -floor_tol_m)
    net_ok = (occurred or not crosses_net) and all(h >= net_height_m for h in heights)
    return {
        "minimum_height_m": float(path[:, 2].min()),
        "net_crossing_height_m": min(heights) if heights else None,
        "net_crossing_required": bool(crosses_net),
        "net_crossing_occurred": occurred,
        "floor_ok": floor_ok,
        "net_ok": bool(net_ok),
    }
