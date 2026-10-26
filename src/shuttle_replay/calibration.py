# SPDX-License-Identifier: AGPL-3.0-only
"""Camera calibration from reviewed ground correspondences and elevated net anchors.

Inputs are human-reviewed image measurements of known court points (metres,
Z=0) plus at least two elevated anchors of known height (normally the net post
tops). Ground points with role "fit" estimate the floor homography; points
with role "heldout" are never used for fitting and are reported separately.
The elevated anchors recover the vertical column of the 3x4 camera P. Metric
scope is the BWF court frame; accuracy is bounded by anchor measurement
uncertainty, which is propagated as a sensitivity report.
"""

import itertools
import math

import numpy as np

from .court import NET_Y_M
from .geometry import apply_homography, camera_center, project, ray_at_plane_y

SCHEMA = "shuttle-replay/calibration/v1"
H_SCOPE = "floor homography: valid only for court-plane points with Z=0; never for airborne XYZ"


class CalibrationError(ValueError):
    pass


def _finite(values, what):
    arr = np.asarray(values, float)
    if not np.all(np.isfinite(arr)):
        raise CalibrationError(f"{what} must be finite numbers")
    return arr


def _normalize(pts):
    c = pts.mean(0)
    s = math.sqrt(2) / max(np.mean(np.linalg.norm(pts - c, axis=1)), 1e-12)
    return np.array([[s, 0, -s * c[0]], [0, s, -s * c[1]], [0, 0, 1]])


def _check_spread(world, image):
    for arr, what in ((world, "world"), (image, "image")):
        if len({tuple(np.round(p, 6)) for p in arr}) != len(arr):
            raise CalibrationError(f"degenerate fit points: duplicate {what} coordinates")
        cov = np.cov((arr - arr.mean(0)).T)
        ev = np.linalg.eigvalsh(cov)
        if ev[0] <= 1e-6 * max(ev[1], 1e-12):
            raise CalibrationError(f"degenerate fit points: {what} points are collinear")
    if len(world) == 4:
        for tri in itertools.combinations(range(4), 3):
            a, b, c = world[list(tri)]
            u, w = b - a, c - a
            if abs(u[0] * w[1] - u[1] * w[0]) < 1e-3:
                raise CalibrationError("degenerate fit points: three of four are collinear")


def fit_homography(world_xy, image_uv):
    """Normalized DLT homography mapping world (X, Y) to image (u, v)."""
    world, image = np.asarray(world_xy, float), np.asarray(image_uv, float)
    if len(world) < 4:
        raise CalibrationError("need at least four fit ground points")
    _check_spread(world, image)
    Tw, Ti = _normalize(world), _normalize(image)
    wn = apply_homography(Tw, world)
    im = apply_homography(Ti, image)
    rows = []
    for (x, y), (u, v) in zip(wn, im, strict=True):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, s, vt = np.linalg.svd(np.asarray(rows))
    if s[-2] < 1e-9 * s[0]:
        raise CalibrationError("degenerate fit points: homography is not uniquely determined")
    Hn = vt[-1].reshape(3, 3)
    H = np.linalg.inv(Ti) @ Hn @ Tw
    if not np.all(np.isfinite(H)) or np.linalg.cond(H) > 1e12:
        raise CalibrationError("degenerate fit points: ill-conditioned homography")
    return H / H[2, 2]


def camera_from_anchors(H, anchors_xyz, anchors_uv):
    """Solve the third (vertical) column of P = [h1 h2 p3 h3] from elevated anchors."""
    A, b = [], []
    for (X, Y, Z), (u, v) in zip(anchors_xyz, anchors_uv, strict=True):
        q = H @ np.array([X, Y, 1.0])
        A += [[Z, 0, -u * Z], [0, Z, -v * Z]]
        b += [u * q[2] - q[0], v * q[2] - q[1]]
    A = np.asarray(A)
    if np.linalg.matrix_rank(A, tol=1e-9 * np.abs(A).max()) < 3:
        raise CalibrationError("elevated anchors do not determine the vertical camera column")
    p3 = np.linalg.lstsq(A, np.asarray(b), rcond=None)[0]
    return np.column_stack((H[:, 0], H[:, 1], p3, H[:, 2]))


def _check_camera(P, world_ground):
    center = camera_center(P)
    if not np.all(np.isfinite(center)) or center[2] <= 0:
        raise CalibrationError("invalid camera: centre is not above the court plane")
    depth = (np.c_[world_ground, np.zeros(len(world_ground)), np.ones(len(world_ground))] @ P.T)[
        :, 2
    ]
    if not (np.all(depth > 0) or np.all(depth < 0)):
        raise CalibrationError("invalid camera: court points on both sides of the camera")
    return center


def _anchor_sensitivity(H, anchors_xyz, anchors_uv, sigmas, P):
    """Vertical shift of a reference point above the net under +/- anchor pixel error."""
    ref = np.array([3.05, NET_Y_M, 3.0])
    uv_ref = project(P, ref)[0]
    shifts = []
    for i, j in itertools.product(range(len(anchors_uv)), range(2)):
        for sign in (-1, 1):
            uv = np.array(anchors_uv, float)
            uv[i, j] += sign * sigmas[i]
            try:
                Pp = camera_from_anchors(H, anchors_xyz, uv)
                shifts.append(abs(ray_at_plane_y(Pp, uv_ref, NET_Y_M)[2] - ref[2]))
            except (CalibrationError, ValueError, np.linalg.LinAlgError):
                shifts.append(float("inf"))
    return {
        "reference_point_m": ref.tolist(),
        "perturbation": "each anchor u or v shifted by its stated uncertainty_px",
        "max_vertical_shift_m": float(max(shifts)),
    }


def calibrate_segment(seg):
    sid = seg.get("segment_id")
    if sid is None:
        raise CalibrationError("segment_id is required")
    pts = seg.get("ground_points") or []
    names = [p.get("name") for p in pts]
    if len(set(names)) != len(names):
        raise CalibrationError(f"segment {sid}: ground point names must be unique")
    fit = [p for p in pts if p.get("role") == "fit"]
    held = [p for p in pts if p.get("role") == "heldout"]
    if any(p.get("role") not in ("fit", "heldout") for p in pts):
        raise CalibrationError(f"segment {sid}: ground point role must be 'fit' or 'heldout'")
    if not held:
        raise CalibrationError(f"segment {sid}: at least one held-out ground point is required")
    fw = _finite([p["world_m"][:2] for p in fit], "fit world_m")
    fi = _finite([p["image_px"] for p in fit], "fit image_px")
    hw = _finite([p["world_m"][:2] for p in held], "held-out world_m")
    hi = _finite([p["image_px"] for p in held], "held-out image_px")
    anchors = seg.get("net_anchors") or []
    if len(anchors) < 2:
        raise CalibrationError(f"segment {sid}: need at least two elevated net anchors")
    axyz = _finite([a["world_m"] for a in anchors], "anchor world_m")
    auv = _finite([a["image_px"] for a in anchors], "anchor image_px")
    sig = _finite([a.get("uncertainty_px", 3.0) for a in anchors], "anchor uncertainty_px")
    if axyz.shape[1] != 3 or np.any(axyz[:, 2] <= 0.1):
        raise CalibrationError(f"segment {sid}: net anchors must be elevated (Z > 0.1 m)")

    H = fit_homography(fw, fi)
    Hinv = np.linalg.inv(H)
    P = camera_from_anchors(H, axyz, auv)
    center = _check_camera(P, np.r_[fw, hw])

    def residuals(world, image, items):
        pred = apply_homography(H, world)
        back = apply_homography(Hinv, image)
        return [
            {
                "name": p["name"],
                "world_m": w.tolist(),
                "observed_image_px": i.tolist(),
                "predicted_image_px": q.tolist(),
                "error_px": float(np.linalg.norm(q - i)),
                "error_m": float(np.linalg.norm(bk - w)),
            }
            for p, w, i, q, bk in zip(items, world, image, pred, back, strict=True)
        ]

    held_err = residuals(hw, hi, held)
    epx = np.array([r["error_px"] for r in held_err])
    em = np.array([r["error_m"] for r in held_err])
    anchor_res = np.linalg.norm(project(P, axyz) - auv, axis=1)
    return {
        "segment_id": sid,
        "image_size": seg.get("image_size"),
        "H_world_to_image": H.tolist(),
        "H_image_to_world": (Hinv / Hinv[2, 2]).tolist(),
        "H_scope": H_SCOPE,
        "P": P.tolist(),
        "P_scope": "metric pinhole camera in the BWF court frame (metres, Z up)",
        "camera_center_m": center.tolist(),
        "fit_ground_residuals": residuals(fw, fi, fit),
        "heldout_ground_errors": held_err,
        "heldout_summary": {
            "n": len(held_err),
            "mean_px": float(epx.mean()),
            "max_px": float(epx.max()),
            "mean_m": float(em.mean()),
            "max_m": float(em.max()),
            "note": "held-out points were excluded from the homography fit",
        },
        "net_anchor_residuals_px": anchor_res.tolist(),
        "net_anchor_sensitivity": _anchor_sensitivity(H, axyz, auv, sig, P),
        "uncertainty_note": (
            "Two anchors give a nearly exactly determined vertical column, so a small anchor "
            "residual does not prove 3D accuracy; heights scale with anchor pixel error."
        ),
        "inputs": {"ground_points": pts, "net_anchors": anchors},
    }


def calibrate(data):
    segments = data.get("segments") or []
    if not segments:
        raise CalibrationError("calibration input has no segments")
    ids = [s.get("segment_id") for s in segments]
    if len(set(ids)) != len(ids):
        raise CalibrationError("duplicate segment_id in calibration input")
    return {"schema": SCHEMA, "segments": [calibrate_segment(s) for s in segments]}


def camera_by_segment(calibration):
    if calibration.get("schema") != SCHEMA:
        raise CalibrationError(f"expected calibration schema {SCHEMA}")
    return {s["segment_id"]: s for s in calibration["segments"]}
