# SPDX-License-Identifier: AGPL-3.0-only
"""Singles player discovery from raw YOLO pose candidates and the automatic floor reference.

A candidate's floor point comes only from its ankle keypoints (never the box bottom). Only
people standing in the playing area (court plus a run-off margin) are eligible, which
excludes umpires, line judges and spectators; the near and far halves each keep one
player, preferring continuity with the previous frame. Without a floor reference no
identities are assigned (raw candidates stay in the job's raw output).
"""

from __future__ import annotations

import numpy as np

from ..court import COURT_LENGTH_M, COURT_WIDTH_M, NET_Y_M

ANKLES = (15, 16)
KP_MIN = 0.3
PLAY_X = (-1.0, COURT_WIDTH_M + 1.0)
PLAY_Y = (-2.5, COURT_LENGTH_M + 2.5)
MAX_JUMP_M = 2.5


def ankle_anchor(kps):
    if not kps or len(kps) != 17:
        return None, None
    ok = [kps[i] for i in ANKLES if kps[i][2] >= KP_MIN]
    if len(ok) == 2:
        return [(ok[0][0] + ok[1][0]) / 2, (ok[0][1] + ok[1][1]) / 2], "ankle_midpoint"
    if len(ok) == 1:
        return [ok[0][0], ok[0][1]], "single_ankle"
    return None, None


def to_floor(h, xy):
    p = np.asarray(h, float) @ np.array([xy[0], xy[1], 1.0])
    if p[2] <= 1e-9:
        return None
    return [float(p[0] / p[2]), float(p[1] / p[2])]


def select_singles(frames, h_img_to_court):
    """frames: per-frame lists of {box_px, score, keypoints}. Returns per-frame viewer players."""
    if h_img_to_court is None:
        return [[] for _ in frames]
    prev = {"near": None, "far": None}
    out = []
    for cands in frames:
        halves = {"near": [], "far": []}
        for c in cands:
            anchor, status = ankle_anchor(c.get("keypoints"))
            if anchor is None:
                continue
            xy = to_floor(h_img_to_court, anchor)
            if xy is None or not (
                PLAY_X[0] <= xy[0] <= PLAY_X[1] and PLAY_Y[0] <= xy[1] <= PLAY_Y[1]
            ):
                continue
            halves["near" if xy[1] > NET_Y_M else "far"].append((c, anchor, status, xy))
        chosen = []
        for pid, opts in halves.items():
            if not opts:
                prev[pid] = None
                continue
            last = prev[pid]
            near_last = [
                o
                for o in opts
                if last is not None and np.hypot(o[3][0] - last[0], o[3][1] - last[1]) <= MAX_JUMP_M
            ]
            if near_last:
                c, anchor, status, xy = min(
                    near_last, key=lambda o: np.hypot(o[3][0] - last[0], o[3][1] - last[1])
                )
            else:
                c, anchor, status, xy = max(
                    opts, key=lambda o: o[0]["score"] * (o[0]["box_px"][3] - o[0]["box_px"][1])
                )
            prev[pid] = xy
            chosen.append(
                {
                    "id": pid,
                    "box_px": [round(float(v), 2) for v in c["box_px"]],
                    "anchor_px": [round(float(v), 2) for v in anchor],
                    "court_xy_m": [round(xy[0], 3), round(xy[1], 3)],
                    "keypoints": [
                        [
                            round(float(k[0]), 2),
                            round(float(k[1]), 2),
                            round(min(1.0, max(0.0, float(k[2]))), 4),
                        ]
                        for k in c["keypoints"]
                    ],
                    "score": round(min(1.0, max(0.0, float(c["score"]))), 4),
                    "status": "detected",
                    "anchor_status": status,
                }
            )
        out.append(chosen)
    return out
