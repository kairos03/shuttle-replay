# SPDX-License-Identifier: AGPL-3.0-only
"""In-browser (Pyodide) driver for the R5 court/physics stages.

Runs the same tail as ``shuttle_replay.auto.pipeline.run`` after model inference:
player-free median of the longest segment's calibration frames -> automatic court-line
calibration (courtcal) -> singles player selection (players) -> conditional camera
(shuttleref) -> shared-contact gravity+drag joint fit (jointfit) -> analysis/v1 (export).
The vendored modules under ``shuttle_replay/`` are byte-identical copies of the R5 source;
nothing here clamps, shrinks or replaces their outputs.
"""

from __future__ import annotations

import platform
import sys
import time

import numpy as np
from shuttle_replay.auto import courtcal, export, jointfit, players, shuttleref

CALIB_MAX_W = 1920  # pipeline.CALIB_MAX_W
BG_FRAMES = 25  # pipeline.BG_FRAMES


class PhysicsInputError(ValueError):
    pass


def _check(pts, segments, shuttle_px, pose_raw, width, height):
    n = len(pts)
    if n == 0:
        raise PhysicsInputError("pts is empty")
    if len(shuttle_px) != n or len(pose_raw) != n:
        raise PhysicsInputError(
            f"length mismatch: pts={n} shuttle_px={len(shuttle_px)} pose_raw={len(pose_raw)}"
        )
    if not (width > 0 and height > 0):
        raise PhysicsInputError(f"invalid source size {width}x{height}")
    for i in range(1, n):
        if not pts[i] > pts[i - 1]:
            raise PhysicsInputError(f"pts not strictly increasing at frame {i}")
    if not segments:
        raise PhysicsInputError("no segments")
    prev = 0
    for a, b in segments:
        if not (prev <= a < b <= n):
            raise PhysicsInputError(f"invalid segment [{a}, {b}) for {n} frames")
        prev = b


def median_background(frames, width):
    """(uint8 median image, frame ids). Mirrors pipeline.run's bg pool (<= CALIB_MAX_W)."""
    import cv2

    imgs, ids, shape = [], [], None
    for f in frames:
        w, h = int(f["width"]), int(f["height"])
        rgb = np.frombuffer(f["rgb"], np.uint8)
        if rgb.size != w * h * 3:
            raise PhysicsInputError(f"calibration frame {f.get('frame_id')}: rgb size mismatch")
        rgb = rgb.reshape(h, w, 3)
        if w > CALIB_MAX_W:
            rgb = cv2.resize(
                rgb, (CALIB_MAX_W, round(h * CALIB_MAX_W / w)), interpolation=cv2.INTER_AREA
            )
        if shape is None:
            shape = rgb.shape
        elif rgb.shape != shape:
            raise PhysicsInputError("calibration frames differ in size")
        imgs.append(rgb)
        ids.append(f.get("frame_id"))
    if len(imgs) > BG_FRAMES:
        keep = np.linspace(0, len(imgs) - 1, BG_FRAMES).astype(int)
        imgs, ids = [imgs[j] for j in keep], [ids[j] for j in keep]
    return np.median(np.stack(imgs), axis=0).astype(np.uint8), ids


def calibrate(bg, width):
    """pipeline.run court block: courtcal on bg, rescaled to source pixels."""
    cal = courtcal.calibrate(bg)
    if cal is not None and bg.shape[1] != width:
        s = bg.shape[1] / width
        scale = np.diag([s, s, 1.0])
        inv = np.array(cal["image_to_court_h"]) @ scale
        cal["image_to_court_h"] = (inv / inv[2, 2]).tolist()
        # court_to_image_h stays consistent with image_to_court_h (source pixels)
        fwd = np.linalg.inv(np.array(cal["image_to_court_h"]))
        cal["court_to_image_h"] = (fwd / fwd[2, 2]).tolist()
        for anc in cal["anchors"]:
            anc["image_px"] = [round(v / s, 2) for v in anc["image_px"]]
    return cal


def analyze(payload, progress=None):
    t0 = time.monotonic()
    say = progress or (lambda stage, frac: None)
    pts = [float(t) for t in payload["pts"]]
    segments = [(int(a), int(b)) for a, b in payload["segments"]]
    shuttle_px = [None if p is None else [float(p[0]), float(p[1])] for p in payload["shuttle_px"]]
    pose_raw = payload["pose_raw"]
    width, height = int(payload["width"]), int(payload["height"])
    _check(pts, segments, shuttle_px, pose_raw, width, height)
    n = len(pts)
    longest = max(range(len(segments)), key=lambda k: segments[k][1] - segments[k][0])
    a, b = segments[longest]

    say("court", 0.0)
    frames = payload.get("calibrationFrames") or []
    cal, bg_ids = None, []
    if frames:
        ids = [f.get("frame_id") for f in frames]
        if any(i is None or not a <= int(i) < b for i in ids):
            raise PhysicsInputError(
                f"calibrationFrames must carry frame_id inside the longest segment [{a}, {b})"
            )
        bg, bg_ids = median_background(frames, width)
        cal = calibrate(bg, width)
    h = np.array(cal["image_to_court_h"]) if cal else None
    say("players", 0.2)
    seg_players = [[] for _ in range(n)]
    if h is not None:
        seg_players[a:b] = players.select_singles(pose_raw[a:b], h)
    say("trajectory", 0.3)
    if h is not None:
        cam, cam_reason = shuttleref.camera_from_floor_h(np.linalg.inv(h), width, height)
    elif not frames:
        cam, cam_reason = None, "no calibration frames supplied"
    else:
        cam, cam_reason = None, "no automatic court calibration"
    shuttle_reference = jointfit.build_joint_reference(
        pts,
        shuttle_px,
        segments,
        longest if h is not None else None,
        cam,
        reason=cam_reason,
        players=seg_players,
    )
    say("export", 0.95)
    import cv2
    import scipy

    provenance = dict(payload.get("provenance") or {})
    provenance["physics"] = {
        "engine": "pyodide" if sys.platform == "emscripten" else "cpython",
        "python": platform.python_version(),
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "opencv": cv2.__version__,
        "modules": "R5 shuttle_replay.auto courtcal/players/shuttleref/flightfit/jointfit/export",
        "calibration_frames": len(frames),
        "calibration_frame_ids": [int(i) for i in bg_ids],
        "calibrated_segment": longest,
        "elapsed_s": round(time.monotonic() - t0, 2),
    }
    return export.build_analysis(
        source_sha256=payload["source_sha256"],
        pts=pts,
        segments=segments,
        shuttle_px=shuttle_px,
        players=seg_players,
        calibration=cal,
        calibrated_segment=longest,
        provenance=provenance,
        shuttle_reference=shuttle_reference,
    )
