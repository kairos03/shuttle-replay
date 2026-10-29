# SPDX-License-Identifier: AGPL-3.0-only
"""Conditional camera from the automatic floor homography, plus the superseded fixed-height
ray reference (``build_reference``, kept as a comparison baseline; the pipeline now uses
``flightfit.build_flight_reference``).

Original description of the fixed-height reference:

The automatic floor homography alone cannot place an airborne shuttle: mapping its pixel
through the floor plane would put it where its ray hits the ground. Instead a camera is
inferred from that homography under disclosed priors (principal point at the image centre,
square pixels, zero skew; focal length from the orthogonality and equal-norm constraints of
the floor axes, gated), and each actual TrackNet pixel's ray is intersected with a plane at
a nominal shuttle height (1.5 m by default). The result is a reference position under that
camera/height assumption, not a measurement, a ground projection or a fitted flight.

Gaps inside the calibrated camera segment are shown by a separate layer: linear
interpolation in actual PTS between two estimated seeds no more than ``max_gap_s`` apart,
otherwise a hold of the previous (or, before the first seed, the next) estimated seed with
its own frame id and PTS. Raw observations and nulls are never changed; other segments and
cut frames get nothing.
"""

from __future__ import annotations

import numpy as np

NOMINAL_HEIGHT_M = 1.5
MAX_GAP_S = 1.0
MAX_ABS_M = 100.0  # viewer parser bound; larger values are rejected, never clamped
FOCAL_RANGE = (0.2, 10.0)  # x image width
HEIGHT_RANGE_M = (1.0, 60.0)
MAX_AXIS_COS = 0.05
MAX_NORM_RATIO = 1.1
METHOD = "auto_height_prior_ray_v1"


def camera_from_floor_h(court_to_image_h, width, height):
    """(camera, None) or (None, reason). Court frame: x across, y far->near, z = x × y (down)."""
    h = np.asarray(court_to_image_h, float)
    if h.shape != (3, 3) or not np.isfinite(h).all():
        return None, "floor homography is not a finite 3x3 matrix"
    cx, cy = width / 2.0, height / 2.0
    a = np.array([[1, 0, -cx], [0, 1, -cy], [0, 0, 1.0]]) @ h
    a1, a2 = a[:, 0], a[:, 1]
    # Each constraint is linear in w = 1/f^2: c*w + d = 0. Only constraints whose perspective
    # term d is well conditioned are used (e.g. orthogonality is degenerate for a camera on
    # the court centre line); the other one remains a consistency check below.
    p2 = a1[2] ** 2 + a2[2] ** 2
    if p2 < 1e-18:
        return None, "focal length is not observable from this homography (no perspective)"
    eqs = [
        (a1[0] * a2[0] + a1[1] * a2[1], a1[2] * a2[2]),  # floor axes orthogonal
        (a1[0] ** 2 + a1[1] ** 2 - a2[0] ** 2 - a2[1] ** 2, a1[2] ** 2 - a2[2] ** 2),  # equal norm
    ]
    ws = [(-d / c, abs(d) / p2) for c, d in eqs if abs(d) / p2 > 0.1 and abs(c) > 1e-12]
    if not ws:
        return None, "focal length is not observable from this homography"
    w = sum(wi * q for wi, q in ws) / sum(q for _, q in ws)
    if not w > 0:
        return None, "floor homography implies an imaginary focal length"
    f = 1.0 / np.sqrt(w)
    if not FOCAL_RANGE[0] * width <= f <= FOCAL_RANGE[1] * width:
        return None, f"implausible focal length {f:.0f} px"
    k = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1.0]])
    ki = np.linalg.inv(k)
    r1, r2, t = ki @ h[:, 0], ki @ h[:, 1], ki @ h[:, 2]
    n1, n2 = np.linalg.norm(r1), np.linalg.norm(r2)
    cos = abs(np.dot(r1, r2)) / (n1 * n2)
    ratio = max(n1, n2) / min(n1, n2)
    if cos > MAX_AXIS_COS or ratio > MAX_NORM_RATIO:
        return (
            None,
            f"floor axes not consistent with the camera prior "
            f"(cos {cos:.3f}, norm ratio {ratio:.3f})",
        )
    s = 2.0 / (n1 + n2)
    r1, r2, t = r1 * s, r2 * s, t * s
    if t[2] < 0:  # court origin must be in front of the camera
        r1, r2, t = -r1, -r2, -t
    u, _, vt = np.linalg.svd(np.c_[r1, r2, np.cross(r1, r2)])
    r = u @ vt
    centre = -r.T @ t
    cam_height = -centre[2]
    if not HEIGHT_RANGE_M[0] <= cam_height <= HEIGHT_RANGE_M[1]:
        return None, f"implausible camera height {cam_height:.1f} m"
    return {
        "k": k,
        "r": r,
        "t": t,
        "focal_px": float(f),
        "principal_point_px": [cx, cy],
        "centre_m": [float(centre[0]), float(centre[1]), float(cam_height)],
        "checks": {"axis_cos": round(float(cos), 5), "axis_norm_ratio": round(float(ratio), 5)},
    }, None


def ray_at_height(cam, px, height_m):
    """Court xy where the pixel's ray reaches height_m above the floor, or None."""
    d = cam["r"].T @ (np.linalg.inv(cam["k"]) @ np.array([px[0], px[1], 1.0]))
    c = -cam["r"].T @ cam["t"]
    if abs(d[2]) < 1e-12:
        return None
    s = (-height_m - c[2]) / d[2]
    if not np.isfinite(s) or s <= 0:
        return None
    xy = c[:2] + s * d[:2]
    if not np.isfinite(xy).all() or np.abs(xy).max() > MAX_ABS_M:
        return None
    return [round(float(xy[0]), 3), round(float(xy[1]), 3)]


def _fill_run(run, est, pts, max_gap_s, refs, hold):
    """Estimated frames plus the labelled gap layer inside one uninterrupted run."""
    seeds = [i for i in run if i in est]
    if not seeds:
        return
    k = 0  # index of the first seed >= i
    for i in run:
        while k < len(seeds) and seeds[k] < i:
            k += 1
        if i in est:
            refs[i] = {
                "status": "estimated",
                "xy_m": est[i],
                "flight_id": None,
                "reference_frame_id": None,
                "reference_pts_s": None,
            }
            continue
        p = seeds[k - 1] if k > 0 else None
        q = seeds[k] if k < len(seeds) else None
        if p is not None and q is not None and pts[q] - pts[p] <= max_gap_s:
            w = (pts[i] - pts[p]) / (pts[q] - pts[p])
            xy = [round(est[p][m] * (1 - w) + est[q][m] * w, 3) for m in (0, 1)]
            refs[i] = {
                "status": "interpolated",
                "xy_m": xy,
                "flight_id": None,
                "reference_frame_id": None,
                "reference_pts_s": None,
            }
        else:
            refs[i] = hold(p if p is not None else q)


def _unavailable(n, note):
    return {"status": "unavailable", "method": METHOD, "note": note}, [None] * n


def build_reference(
    pts,
    shuttle_px,
    segments,
    calibrated_segment,
    cam,
    *,
    height_m=NOMINAL_HEIGHT_M,
    max_gap_s=MAX_GAP_S,
    reason=None,
):
    """(top-level metadata, per-frame refs or None). Never alters shuttle_px."""
    n = len(pts)
    if cam is None:
        return _unavailable(n, f"No conditional shuttle reference: {reason or 'no camera'}.")
    if calibrated_segment is None or not 0 <= calibrated_segment < len(segments):
        return _unavailable(n, "No conditional shuttle reference: no calibrated camera segment.")
    a, b = segments[calibrated_segment]
    est = {}
    rejected = 0
    barriers = set()  # rejected observations: no display there and nothing bridges across them
    for i in range(a, b):
        if shuttle_px[i] is None:
            continue
        xy = ray_at_height(cam, shuttle_px[i], height_m)
        if xy is None:
            rejected += 1
            barriers.add(i)
        else:
            est[i] = xy
    if not est:
        return _unavailable(n, "No conditional shuttle reference: no usable shuttle observation.")
    refs = [None] * n

    def hold(j):
        return {
            "status": "reference",
            "xy_m": est[j],
            "flight_id": None,
            "reference_frame_id": j,
            "reference_pts_s": pts[j],
        }

    # The gap layer works inside uninterrupted runs between rejected observations only; a run
    # without an estimated seed shows nothing.
    bounds = [a - 1, *sorted(barriers), b]
    for lo, hi in zip(bounds, bounds[1:], strict=False):
        _fill_run(range(lo + 1, hi), est, pts, max_gap_s, refs, hold)
    counts = {
        s: sum(1 for r in refs if r and r["status"] == s)
        for s in ("estimated", "interpolated", "reference")
    }
    counts["rejected"] = rejected
    counts["none"] = sum(1 for r in refs if r is None)
    centre = cam["centre_m"]
    top = {
        "status": "conditional_reference",
        "method": (
            f"{METHOD}: camera inferred from the automatic floor homography; each TrackNet "
            f"pixel ray intersected with a {height_m} m plane"
        ),
        "note": (
            "Display-only conditional reference, NOT a measurement, ground projection or fitted "
            "flight. interpolated = linear in PTS between two estimated frames; reference = "
            "nearest estimated frame held with its own time. Raw observations are unchanged."
        ),
        "assumptions": [
            f"Shuttle at a nominal {height_m} m above the floor in every frame (not measured).",
            "Camera intrinsics: principal point at the image centre, square pixels, zero "
            f"skew; focal length {cam['focal_px']:.0f} px derived from the automatic floor "
            "homography.",
            f"Camera centre about ({centre[0]:.1f}, {centre[1]:.1f}) m at {centre[2]:.1f} m "
            "height, derived, not surveyed.",
            "The automatic floor homography (automatic_reference) is correct.",
            f"Gaps up to {max_gap_s} s are interpolated; longer or edge gaps hold a detected "
            "frame.",
        ],
        "coordinate_system": {
            "x_m": "0..6.1 across, x=0 image-left doubles sideline",
            "y_m": "0 FAR end .. 13.4 NEAR camera end; net y=6.7",
            "bounds": "not clipped; off-court values are kept",
        },
        "height_m": height_m,
        "max_interpolation_gap_s": max_gap_s,
        "camera": {
            "focal_px": round(cam["focal_px"], 2),
            "principal_point_px": cam["principal_point_px"],
            "centre_m": [round(v, 3) for v in centre],
            "checks": cam["checks"],
        },
        "segment_id": f"s{calibrated_segment}",
        "counts": counts,
    }
    return top, refs
