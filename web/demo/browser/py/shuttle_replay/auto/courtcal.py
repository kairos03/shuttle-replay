# SPDX-License-Identifier: AGPL-3.0-only
"""Automatic floor reference from the court lines visible in the video.

White line pixels are extracted from a player-free median frame, straight lines are
found with a Hough transform, and every assignment of two image lines across and two
along the court to BWF line positions is scored by how many projected court-line samples
land on line pixels (minus how many line-free court samples do). The best hypothesis is
refined against line centres. The result is a floor-only homography labelled
``automatic_reference``: an estimate, not a surveyed calibration, and never a camera
model for airborne points. When no hypothesis is convincing, ``None`` is returned.
"""

from __future__ import annotations

import itertools

import numpy as np

from ..court import COURT_LENGTH_M, COURT_WIDTH_M, NET_Y_M, court_lines

# Line-centre positions (court.py convention). Across: outer and singles sidelines.
X_LINES = (0.02, 0.48, COURT_WIDTH_M - 0.48, COURT_WIDTH_M - 0.02)
# Along: baselines, doubles long service and short service lines (the net is not a floor line).
Y_LINES = (0.02, 0.78, NET_Y_M - 2.0, NET_Y_M + 2.0, COURT_LENGTH_M - 0.78, COURT_LENGTH_M - 0.02)
MIN_SCORE = 0.6
MAX_LINES = 8


def _samples(step=0.2):
    pts = []
    for (x0, y0), (x1, y1) in court_lines():
        n = max(2, int(np.hypot(x1 - x0, y1 - y0) / step))
        t = np.linspace(0, 1, n)
        pts.append(np.c_[x0 + (x1 - x0) * t, y0 + (y1 - y0) * t])
    return np.vstack(pts)


def _interior(step=0.5):
    """Court-floor points at least 0.15 m from every line (should not be white)."""
    xs = np.arange(0.25, COURT_WIDTH_M, step)
    ys = np.arange(0.3, COURT_LENGTH_M, step)
    g = np.array([(x, y) for x in xs for y in ys])
    keep = np.ones(len(g), bool)
    for x in (*X_LINES, COURT_WIDTH_M / 2):
        keep &= np.abs(g[:, 0] - x) > 0.15
    for y in Y_LINES:
        keep &= np.abs(g[:, 1] - y) > 0.15
    return g[keep]


LINE_SAMPLES = _samples()
INTERIOR = _interior()


def line_mask(rgb):
    import cv2

    h, w = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    sat = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)[..., 1]
    k = max(9, int(round(w / 60)) | 1)
    tophat = cv2.morphologyEx(
        gray, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    )
    return ((tophat > 25) & (gray > 110) & (sat < 90)).astype(np.uint8)


def _lines(mask):
    """Merged straight lines: list of (a, b, c, support) with a*x + b*y + c = 0, |(a,b)| = 1."""
    import cv2

    h, w = mask.shape
    segs = cv2.HoughLinesP(
        mask * 255,
        1,
        np.pi / 360,
        threshold=50,
        minLineLength=int(w * 0.05),
        maxLineGap=int(w * 0.012),
    )
    if segs is None:
        return []
    segs = sorted(
        (s.astype(float) for s in segs.reshape(-1, 4)),
        key=lambda s: -np.hypot(s[2] - s[0], s[3] - s[1]),
    )
    tol = max(3.0, w / 400)
    groups = []
    for x1, y1, x2, y2 in segs:
        d = np.array([x2 - x1, y2 - y1])
        length = float(np.hypot(*d))
        n = np.array([-d[1], d[0]]) / length
        for g in groups:
            a, b, c = g["line"]
            if (
                abs(a * n[1] - b * n[0]) < np.sin(np.radians(2))
                and abs(a * x1 + b * y1 + c) < tol
                and abs(a * x2 + b * y2 + c) < tol
            ):
                g["pts"] += [(x1, y1), (x2, y2)]
                g["support"] += length
                break
        else:
            groups.append(
                {
                    "line": (n[0], n[1], -(n[0] * x1 + n[1] * y1)),
                    "pts": [(x1, y1), (x2, y2)],
                    "support": length,
                }
            )
    out = []
    for g in groups:
        p = np.array(g["pts"])
        mu = p.mean(0)
        _, _, vt = np.linalg.svd(p - mu)
        a, b = vt[1]
        out.append((a, b, -(a * mu[0] + b * mu[1]), g["support"]))
    return out


def _intersect(l1, l2):
    a1, b1, c1 = l1[:3]
    a2, b2, c2 = l2[:3]
    det = a1 * b2 - a2 * b1
    if abs(det) < 1e-9:
        return None
    return ((b1 * c2 - b2 * c1) / det, (a2 * c1 - a1 * c2) / det)


def _homographies(src, dst):
    """Batch 4-point DLT: src, dst (K,4,2) -> H (K,3,3) mapping src to dst (NaN if singular)."""
    k = len(src)
    a = np.zeros((k, 8, 8))
    rhs = np.zeros((k, 8))
    for i in range(4):
        x, y = src[:, i, 0], src[:, i, 1]
        u, v = dst[:, i, 0], dst[:, i, 1]
        a[:, 2 * i, 0:3] = np.c_[x, y, np.ones(k)]
        a[:, 2 * i, 6:8] = np.c_[-u * x, -u * y]
        a[:, 2 * i + 1, 3:6] = np.c_[x, y, np.ones(k)]
        a[:, 2 * i + 1, 6:8] = np.c_[-v * x, -v * y]
        rhs[:, 2 * i], rhs[:, 2 * i + 1] = u, v
    ok = np.abs(np.linalg.det(a)) > 1e-12
    h = np.full((k, 9), np.nan)
    h[ok, :8] = np.linalg.solve(a[ok], rhs[ok][..., None])[..., 0]
    h[ok, 8] = 1.0
    return h.reshape(k, 3, 3)


def _project(h, pts):
    """h (K,3,3), pts (P,2) -> (K,P,2); points behind the camera become NaN."""
    p = np.einsum("kij,pj->kpi", h, np.c_[pts, np.ones(len(pts))])
    z = p[..., 2:3]
    out = p[..., :2] / np.where(np.abs(z) < 1e-9, np.nan, z)
    out[(z[..., 0] <= 0)] = np.nan
    return out


def _score(h, hit, shape):
    """Line hit rate minus interior hit rate; also the in-image fraction of line samples."""
    rows, cols = shape

    def rate(pts):
        q = _project(h, pts)
        x, y = q[..., 0], q[..., 1]
        inside = np.isfinite(x) & (x >= 0) & (x < cols) & (y >= 0) & (y < rows)
        xi = np.where(inside, x, 0).astype(int)
        yi = np.where(inside, y, 0).astype(int)
        hits = hit[yi, xi] & inside
        n_in = inside.sum(1)
        return hits.sum(1) / np.maximum(n_in, 1), n_in / len(pts)

    line_rate, line_in = rate(LINE_SAMPLES)
    interior_rate, _ = rate(INTERIOR)
    return line_rate - interior_rate, line_rate, line_in


def _plausible(h, shape):
    """Projected outer court: convex, in front of the camera, near end not narrower than far end."""
    rows, cols = shape
    c = _project(
        h[None],
        np.array(
            [(0, 0), (COURT_WIDTH_M, 0), (COURT_WIDTH_M, COURT_LENGTH_M), (0, COURT_LENGTH_M)]
        ),
    )[0]
    if not np.isfinite(c).all():
        return False
    area = 0.5 * abs(np.dot(c[:, 0], np.roll(c[:, 1], 1)) - np.dot(c[:, 1], np.roll(c[:, 0], 1)))

    def cross2(u, v):
        return u[0] * v[1] - u[1] * v[0]

    cross = [cross2(c[(i + 1) % 4] - c[i], c[(i + 2) % 4] - c[(i + 1) % 4]) for i in range(4)]
    far_w = np.linalg.norm(c[1] - c[0])
    near_w = np.linalg.norm(c[2] - c[3])
    return (
        (all(x > 0 for x in cross) or all(x < 0 for x in cross))
        and area > 0.03 * rows * cols
        and near_w >= 0.9 * far_w
        and c[3, 1] > c[0, 1]
        and c[2, 1] > c[1, 1]
    )


def _refine(h, mask, iters=3, radius=6):
    """Move each projected line sample to the local line centre along the line normal; refit."""
    import cv2

    rows, cols = mask.shape
    for _ in range(iters):
        src, dst = [], []
        for (x0, y0), (x1, y1) in court_lines():
            n = max(2, int(np.hypot(x1 - x0, y1 - y0) / 0.1))
            t = np.linspace(0, 1, n)
            cp = np.c_[x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]
            ip = _project(h[None], cp)[0]
            d = ip[-1] - ip[0]
            if not np.isfinite(d).all() or np.hypot(*d) < 1:
                continue
            nrm = np.array([-d[1], d[0]]) / np.hypot(*d)
            offs = np.arange(-radius, radius + 1)
            for c, p in zip(cp, ip, strict=False):
                q = p[None] + offs[:, None] * nrm[None]
                xi, yi = np.round(q[:, 0]).astype(int), np.round(q[:, 1]).astype(int)
                ok = (xi >= 0) & (xi < cols) & (yi >= 0) & (yi < rows)
                if ok.sum() < len(offs):
                    continue
                on = mask[yi, xi] > 0
                if 0 < on.sum() < len(offs):
                    src.append(c)
                    dst.append(p + offs[on].mean() * nrm)
        if len(src) < 12:
            break
        new, _ = cv2.findHomography(
            np.array(src, np.float32), np.array(dst, np.float32), cv2.RANSAC, 3.0
        )
        if new is None:
            break
        h = new / new[2, 2]
    return h


def calibrate(rgb):
    """Automatic floor homography from one (player-free) frame, or None when not found."""
    import cv2

    mask = line_mask(rgb)
    shape = mask.shape
    lines = _lines(mask)
    rows, cols = shape
    flat = np.cos(np.radians(25))
    horiz = [ln for ln in lines if abs(ln[1]) > flat]  # normal close to vertical
    other = [ln for ln in lines if abs(ln[1]) <= flat]
    horiz = sorted(horiz, key=lambda ln: -ln[3])[:MAX_LINES]
    other = sorted(other, key=lambda ln: -ln[3])[:MAX_LINES]
    if len(horiz) < 2 or len(other) < 2:
        return None

    def y_at(ln):
        return -(ln[0] * cols / 2 + ln[2]) / ln[1]

    def x_at(ln):
        return -(ln[1] * rows * 0.6 + ln[2]) / ln[0]

    horiz.sort(key=y_at)
    other.sort(key=x_at)
    src, dst = [], []
    for hi, hj in itertools.combinations(horiz, 2):
        for va, vb in itertools.combinations(other, 2):
            pts = [_intersect(hi, va), _intersect(hi, vb), _intersect(hj, va), _intersect(hj, vb)]
            if any(p is None for p in pts) or any(
                abs(p[0]) > 4 * cols or abs(p[1]) > 4 * rows for p in pts
            ):
                continue
            for ya, yb in itertools.combinations(Y_LINES, 2):
                for xa, xb in itertools.combinations(X_LINES, 2):
                    src.append([(xa, ya), (xb, ya), (xa, yb), (xb, yb)])
                    dst.append(pts)
    if not src:
        return None
    hs = _homographies(np.array(src, float), np.array(dst, float))
    hit = cv2.dilate(mask, np.ones((5, 5), np.uint8)).astype(bool)
    best = None
    for k in range(0, len(hs), 4096):
        chunk = hs[k : k + 4096]
        ok = np.isfinite(chunk).all(axis=(1, 2))
        score, line_rate, line_in = _score(
            np.where(ok[:, None, None], chunk, np.eye(3)), hit, shape
        )
        score = np.where(ok & (line_in >= 0.5), score, -1)
        for i in np.argsort(-score)[:20]:
            if score[i] <= (best[0] if best else MIN_SCORE - 0.15) or not _plausible(
                chunk[i], shape
            ):
                continue
            best = (float(score[i]), chunk[i])
    if best is None:
        return None
    h = _refine(best[1], mask)
    score, line_rate, line_in = (float(v[0]) for v in _score(h[None], hit, shape))
    if score < best[0] - 0.02:
        h = best[1]
        score, line_rate, line_in = (float(v[0]) for v in _score(h[None], hit, shape))
    if score < MIN_SCORE or not _plausible(h, shape):
        return None
    inv = np.linalg.inv(h)
    inv = inv / inv[2, 2]
    corners = [
        ((0.02, 0.02), "far-left outer corner"),
        ((6.08, 0.02), "far-right outer corner"),
        ((0.02, 13.38), "near-left outer corner"),
        ((6.08, 13.38), "near-right outer corner"),
        ((3.05, 4.7), "far short service x centre"),
        ((3.05, 8.7), "near short service x centre"),
    ]
    img = _project(h[None], np.array([c for c, _ in corners]))[0]
    anchors = [
        {
            "image_px": [round(float(p[0]), 2), round(float(p[1]), 2)],
            "court_xy_m": list(c),
            "label": f"automatic: {name} (projected from the fitted lines)",
        }
        for (c, name), p in zip(corners, img, strict=False)
    ]
    return {
        "status": "automatic_reference",
        "image_to_court_h": [[float(v) for v in row] for row in inv],
        "court_to_image_h": [[float(v) for v in row] for row in h],
        "anchors": anchors,
        "score": round(score, 4),
        "line_hit_rate": round(line_rate, 4),
        "line_samples_in_image": round(line_in, 4),
        "method": (
            "auto_court_lines_v1: white-line mask + Hough lines + BWF line-model "
            "hypothesis scoring + line-centre refinement"
        ),
        "note": (
            "Automatic floor reference found from visible court lines. Estimate only: "
            "not surveyed, not a camera model; valid for points on the floor (player "
            "ankles), never for the airborne shuttle."
        ),
    }
