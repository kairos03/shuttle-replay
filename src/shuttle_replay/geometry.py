# SPDX-License-Identifier: AGPL-3.0-only
"""Pinhole projection helpers.

A floor homography maps only Z=0 court points. Airborne points must use the
full 3x4 camera matrix P, which needs elevated anchors (net posts) to recover
the vertical column. Never back-project an airborne pixel through H.
"""

import numpy as np


def project(P, xyz):
    xyz = np.atleast_2d(np.asarray(xyz, float))
    q = np.c_[xyz, np.ones(len(xyz))] @ np.asarray(P, float).T
    return q[:, :2] / q[:, 2:3]


def apply_homography(H, pts):
    pts = np.atleast_2d(np.asarray(pts, float))
    q = np.c_[pts, np.ones(len(pts))] @ np.asarray(H, float).T
    return q[:, :2] / q[:, 2:3]


def camera_center(P):
    P = np.asarray(P, float)
    return -np.linalg.solve(P[:, :3], P[:, 3])


def ray_at_height(P, uv, z):
    """Intersect the viewing ray of image point uv with the horizontal plane Z=z."""
    P = np.asarray(P, float)
    center = camera_center(P)
    d = np.linalg.solve(P[:, :3], np.array([uv[0], uv[1], 1.0]))
    if abs(d[2]) < 1e-12:
        raise ValueError("viewing ray is parallel to the requested height plane")
    return center + d * (z - center[2]) / d[2]


def ray_at_plane_y(P, uv, y):
    """Intersect the viewing ray of uv with the vertical plane Y=y."""
    P = np.asarray(P, float)
    center = camera_center(P)
    d = np.linalg.solve(P[:, :3], np.array([uv[0], uv[1], 1.0]))
    if abs(d[1]) < 1e-12:
        raise ValueError("viewing ray is parallel to the requested plane")
    return center + d * (y - center[1]) / d[1]


def look_at_camera(eye, target, focal_px, image_size):
    """Build a 3x4 pinhole camera (used by synthetic data and tests)."""
    eye, target = np.asarray(eye, float), np.asarray(target, float)
    forward = target - eye
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, [0.0, 0.0, 1.0])
    right /= np.linalg.norm(right)
    down = np.cross(forward, right)
    R = np.vstack([right, down, forward])
    K = np.array([[focal_px, 0, image_size[0] / 2], [0, focal_px, image_size[1] / 2], [0, 0, 1]])
    return K @ np.c_[R, -R @ eye]
