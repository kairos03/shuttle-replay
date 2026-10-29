# SPDX-License-Identifier: AGPL-3.0-only
"""Assemble the viewer's shuttle-replay/analysis/v1 document from automatic outputs.

Only 2D shuttle observations and automatic-reference player floor estimates are written.
No flights, shot types or speeds are produced and the airborne shuttle is never mapped
through the floor homography. An optional separate ``shuttle_map_reference`` layer
(see flightfit.py) carries a conditional flight-model display reference.
"""

from __future__ import annotations

SCHEMA = "shuttle-replay/analysis/v1"


def build_analysis(
    *,
    source_sha256,
    pts,
    segments,
    shuttle_px,
    players,
    calibration,
    calibrated_segment,
    provenance,
    shuttle_reference=None,
):
    ref_top, refs = shuttle_reference if shuttle_reference else (None, [None] * len(pts))
    seg_of = [None] * len(pts)
    seg_docs = []
    for k, (a, b) in enumerate(segments):
        seg_docs.append({"segment_id": f"s{k}", "start_s": pts[a], "end_s": pts[b - 1]})
        for i in range(a, b):
            seg_of[i] = k
    frames = []
    for i, t in enumerate(pts):
        k = seg_of[i]
        if k is None:
            frames.append(
                {
                    "frame_id": i,
                    "pts_s": t,
                    "segment_id": None,
                    "layer": "excluded_camera_cut",
                    "shuttle_observed_px": None,
                    "shuttle_model_px": None,
                    "shuttle_model_xyz_m": None,
                    "model_flight_id": None,
                    "players": [],
                }
            )
            continue
        obs = shuttle_px[i]
        ps = []
        for p in players[i]:
            q = dict(p)
            if calibration is None or k != calibrated_segment:
                q["court_xy_m"] = None
            ps.append(q)
        frames.append(
            {
                "frame_id": i,
                "pts_s": t,
                "segment_id": f"s{k}",
                "layer": "observed_pixel" if obs is not None else "none",
                "shuttle_observed_px": obs,
                "shuttle_model_px": None,
                "shuttle_model_xyz_m": None,
                "model_flight_id": None,
                "players": ps,
            }
        )
        if refs[i] is not None:  # separate conditional display layer, never the raw observation
            frames[-1]["shuttle_map_reference"] = refs[i]
    if calibration is not None:
        player_calibration = {
            k: calibration[k]
            for k in ("status", "image_to_court_h", "anchors", "method", "note", "score")
        }
        player_calibration["segment_id"] = f"s{calibrated_segment}"
    else:
        player_calibration = {
            "status": "unavailable",
            "note": (
                "Court lines were not found automatically; no player floor positions are shown."
            ),
        }
    return {
        "schema": SCHEMA,
        "synthetic": False,
        "analysis_kind": "automatic_local",
        "source_video": "uploaded video (local)",
        "source_sha256": source_sha256,
        "time_mapping": "pts_s = decoded frame PTS minus container start time (browser media time)",
        "segments": seg_docs,
        "flights": [],
        "player_calibration": player_calibration,
        "shuttle_map_reference": ref_top
        or {
            "status": "unavailable",
            "note": "No camera/height reference: shuttle court positions are not estimated.",
        },
        "provenance": provenance,
        "frames": frames,
    }
