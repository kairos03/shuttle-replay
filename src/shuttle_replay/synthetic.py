# SPDX-License-Identifier: AGPL-3.0-only
"""Fully synthetic rally used by the demo and the tests.

Everything here is generated: two virtual cameras separated by a camera cut,
simulated drag flights with known ground truth, noisy pseudo-detections with
gaps (including delayed first observations after contacts), reviewed-looking
annotations and a rendered video with a test tone. No real footage is used.
"""

import json
from fractions import Fraction
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw
from scipy.optimize import least_squares

from .court import court_lines
from .geometry import look_at_camera, project
from .physics import floor_crossing, simulate

IMAGE_SIZE = (640, 360)
TIME_BASE = Fraction(1, 30000)
CAMERAS = {
    0: look_at_camera([3.05, 21.0, 6.2], [3.05, 6.2, 0.0], 380.0, IMAGE_SIZE),
    1: look_at_camera([2.4, 21.5, 6.8], [3.2, 6.4, 0.0], 360.0, IMAGE_SIZE),
}
# (segment, frame range) and camera-cut frames with no court view.
SEGMENTS = {0: range(0, 75), 1: range(90, 180)}
CUT_FRAMES = range(75, 90)
N_FRAMES = 180
# Synthetic ground truth: contact id, segment, time, xyz.
CONTACTS = [
    ("c1", 0, 0.20, [2.0, 11.6, 1.0]),
    ("c2", 0, 1.35, [3.8, 1.9, 2.3]),
    ("c3", 0, 2.10, [2.6, 11.2, 1.2]),
    ("c4", 1, 3.20, [3.6, 1.6, 2.1]),
    ("c5", 1, 3.95, [2.2, 11.9, 0.8]),
]
DRAG_K = 0.2
C5_LANDING_TARGET = [4.6, 1.2, 0.0]
C5_LANDING_TIME = 5.25
C3_VELOCITY = [0.5, -16.0, 6.0]
# Real sources often start audio at a nonzero PTS; the synthetic one does too.
AUDIO_START_OFFSET_SAMPLES = 640
# Line-centre intersections (see court.py convention).
GROUND_FIT = [(0.02, 0.02), (6.08, 0.02), (6.08, 13.38), (0.02, 13.38)]
GROUND_HELDOUT = [(0.48, 4.70), (5.62, 4.70), (0.48, 8.70), (5.62, 8.70), (3.05, 0.78)]


def frame_pts_ticks():
    """Variable frame durations (1000 or 1001 ticks at 1/30000 s), as real VFR sources."""
    ticks, t = [], 0
    for i in range(N_FRAMES):
        ticks.append(t)
        t += 1001 if i % 7 == 3 else 1000
    return ticks


def _shoot(start, target, duration, k=DRAG_K):
    start, target = np.asarray(start, float), np.asarray(target, float)
    v0 = (target - start) / duration
    v0[2] += 4.905 * duration

    def res(v):
        return simulate(np.r_[start, v, k], [duration])[0] - target

    return np.r_[start, least_squares(res, v0, xtol=1e-12, ftol=1e-12).x, k]


def ground_truth_flights():
    flights = []
    by_seg = {}
    for c in CONTACTS:
        by_seg.setdefault(c[1], []).append(c)
    for seg, cs in by_seg.items():
        for a, b in zip(cs, cs[1:], strict=False):
            flights.append(
                {
                    "contact": a[0],
                    "segment_id": seg,
                    "t0": a[2],
                    "t1": b[2],
                    "params": _shoot(a[3], b[3], b[2] - a[2]),
                    "end": "intercepted",
                }
            )
        last = cs[-1]
        if last[0] == "c5":
            p = _shoot(last[3], C5_LANDING_TARGET, C5_LANDING_TIME - last[2])
            flights.append(
                {
                    "contact": "c5",
                    "segment_id": seg,
                    "t0": last[2],
                    "t1": C5_LANDING_TIME,
                    "params": p,
                    "end": "landing",
                }
            )
        else:
            p = np.r_[last[3], C3_VELOCITY, DRAG_K]
            flights.append(
                {
                    "contact": last[0],
                    "segment_id": seg,
                    "t0": last[2],
                    "t1": None,
                    "params": p,
                    "end": "open",
                }
            )
    return flights


def _true_position(flights, seg, t):
    for f in flights:
        if f["segment_id"] != seg or t < f["t0"]:
            continue
        end = f["t1"]
        if end is None:
            fc = floor_crossing(f["params"])
            end = f["t0"] + fc[0] if fc else f["t0"] + 3
        if t <= end:
            return simulate(f["params"], [t - f["t0"]])[0], f
    return None, None


def build_scene(out_dir, seed=7):
    """Write synthetic video, tracks, review and calibration input; return paths + truth."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    ticks = frame_pts_ticks()
    pts = [t * float(TIME_BASE) for t in ticks]
    flights = ground_truth_flights()
    seg_of = {i: s for s, r in SEGMENTS.items() for i in r}
    frames = []
    truth_xyz = {}
    for i, t in enumerate(pts):
        seg = seg_of.get(i)
        rec = {"frame_id": i, "pts_s": t, "segment_id": seg, "shuttle": None, "players": []}
        if seg is None:
            # A spurious detection inside the camera cut that must never be used.
            if i == 80:
                rec["shuttle"] = {"u": 320.0, "v": 100.0, "score": 0.9}
        else:
            P = CAMERAS[seg]
            xyz, f = _true_position(flights, seg, t)
            if xyz is not None:
                truth_xyz[i] = xyz
                since = t - f["t0"]
                delay = 0.30 if f["contact"] == "c1" else 0.12
                if since > delay and rng.random() > 0.12 and xyz[2] > 0:
                    u, v = project(P, xyz)[0] + rng.normal(0, 0.7, 2)
                    rec["shuttle"] = {"u": float(u), "v": float(v), "score": 0.8}
            for label, foot in (("far", [3.0, 2.2]), ("near", [2.5, 11.4])):
                top = project(P, [foot[0], foot[1], 1.8])[0]
                bottom = project(P, [foot[0], foot[1], 0.0])[0]
                h = bottom[1] - top[1]
                rec["players"].append(
                    {
                        "label": label,
                        "score": 0.9,
                        "box": [
                            float(bottom[0] - 0.25 * h),
                            float(top[1]),
                            float(bottom[0] + 0.25 * h),
                            float(bottom[1]),
                        ],
                    }
                )
        frames.append(rec)
    tracks = {
        "schema": "shuttle-replay/tracks/v1",
        "source_video": "synthetic_rally.mp4",
        "synthetic": True,
        "frames": frames,
    }

    contacts = []
    for cid, seg, t, xyz in CONTACTS:
        uv = project(CAMERAS[seg], xyz)[0] + rng.normal(0, 1.0, 2)
        contacts.append(
            {
                "id": cid,
                "segment_id": seg,
                "time_s": t,
                "time_bracket_s": [t - 0.04, t + 0.04],
                "image_px": uv.tolist(),
                "height_m": xyz[2] + 0.05,
                "height_sigma_m": 0.3,
                "review": "synthetic reviewed contact",
            }
        )
    review = {
        "schema": "shuttle-replay/review/v1",
        "synthetic": True,
        "contacts": contacts,
        "flight_ends": [
            {
                "contact_id": "c3",
                "type": "open",
                "review": "rally continues after camera cut; no landing visible",
            },
            {
                "contact_id": "c5",
                "type": "landing_region",
                "time_bracket_s": [C5_LANDING_TIME - 0.12, C5_LANDING_TIME + 0.12],
                "region_xy_m": {
                    "min": [C5_LANDING_TARGET[0] - 0.35, C5_LANDING_TARGET[1] - 0.35],
                    "max": [C5_LANDING_TARGET[0] + 0.35, C5_LANDING_TARGET[1] + 0.35],
                },
                "review": "synthetic reviewer marks landing area (IN)",
            },
        ],
    }

    cal_segments = []
    for seg, P in CAMERAS.items():
        gp = []
        for role, pts_w in (("fit", GROUND_FIT), ("heldout", GROUND_HELDOUT)):
            for j, w in enumerate(pts_w):
                uv = project(P, [w[0], w[1], 0.0])[0] + rng.normal(0, 0.4, 2)
                gp.append(
                    {
                        "name": f"{role}_{j}",
                        "world_m": list(w),
                        "image_px": uv.tolist(),
                        "role": role,
                    }
                )
        anchors = []
        for name, w in (("left_post_top", [0.0, 6.7, 1.55]), ("right_post_top", [6.1, 6.7, 1.55])):
            uv = project(P, w)[0] + rng.normal(0, 0.5, 2)
            anchors.append(
                {"name": name, "world_m": w, "image_px": uv.tolist(), "uncertainty_px": 2.0}
            )
        cal_segments.append(
            {
                "segment_id": seg,
                "image_size": list(IMAGE_SIZE),
                "ground_points": gp,
                "net_anchors": anchors,
            }
        )
    calib_input = {
        "schema": "shuttle-replay/calibration-input/v1",
        "synthetic": True,
        "segments": cal_segments,
    }

    paths = {
        "video": out / "synthetic_rally.mp4",
        "tracks": out / "tracks.json",
        "review": out / "review.json",
        "calibration_input": out / "calibration_input.json",
    }
    for key, obj in (("tracks", tracks), ("review", review), ("calibration_input", calib_input)):
        paths[key].write_text(json.dumps(obj, indent=2))
    _write_video(paths["video"], ticks, seg_of, truth_xyz)
    truth = {
        "synthetic": True,
        "flights": [
            {
                **{k: v for k, v in f.items() if k != "params"},
                "params": f["params"].tolist(),
                "speed_km_h": float(np.linalg.norm(f["params"][3:6]) * 3.6),
            }
            for f in flights
        ],
        "c5_landing_xy_m": C5_LANDING_TARGET[:2],
        "c5_landing_time_s": C5_LANDING_TIME,
    }
    return paths, truth


def _write_video(path, ticks, seg_of, truth_xyz):
    w, h = IMAGE_SIZE
    rate = 16000
    with av.open(str(path), "w") as c:
        vs = c.add_stream("mpeg4", rate=30)
        vs.width, vs.height, vs.pix_fmt = w, h, "yuv420p"
        vs.codec_context.time_base = TIME_BASE
        vs.time_base = TIME_BASE
        a = c.add_stream("aac", rate=rate)
        a.layout = "mono"
        for i, tick in enumerate(ticks):
            seg = seg_of.get(i)
            img = Image.new("RGB", (w, h), (32, 96, 64) if seg is not None else (70, 60, 80))
            d = ImageDraw.Draw(img)
            if seg is not None:
                P = CAMERAS[seg]
                for (x0, y0), (x1, y1) in court_lines():
                    a0, a1 = project(P, [[x0, y0, 0], [x1, y1, 0]])
                    d.line([tuple(a0), tuple(a1)], fill=(235, 235, 235), width=1)
                n0, n1 = project(P, [[0, 6.7, 1.55], [6.1, 6.7, 1.55]])
                b0, b1 = project(P, [[0, 6.7, 0], [6.1, 6.7, 0]])
                d.line([tuple(n0), tuple(n1)], fill=(250, 250, 250), width=2)
                d.line([tuple(n0), tuple(b0)], fill=(200, 200, 200), width=2)
                d.line([tuple(n1), tuple(b1)], fill=(200, 200, 200), width=2)
                if i in truth_xyz:
                    u, v = project(P, truth_xyz[i])[0]
                    d.ellipse([u - 3, v - 3, u + 3, v + 3], fill=(255, 255, 255))
            else:
                d.text((20, 20), "SYNTHETIC CLOSE-UP (camera cut)", fill=(255, 255, 255))
            d.text((8, h - 16), f"synthetic frame {i}", fill=(255, 255, 0))
            frame = av.VideoFrame.from_image(img)
            frame.pts = tick
            frame.time_base = TIME_BASE
            for pkt in vs.encode(frame):
                c.mux(pkt)
        for pkt in vs.encode():
            c.mux(pkt)
        total = int((ticks[-1] + 1000) * float(TIME_BASE) * rate)
        tt = np.arange(total) / rate
        tone = (0.2 * np.sin(2 * np.pi * 440 * tt)).astype(np.float32)
        fs = a.codec_context.frame_size or 1024
        for s in range(0, total, fs):
            chunk = tone[s : s + fs]
            if len(chunk) < fs:
                chunk = np.pad(chunk, (0, fs - len(chunk)))
            af = av.AudioFrame.from_ndarray(chunk[None, :], format="fltp", layout="mono")
            af.sample_rate = rate
            af.pts = s + AUDIO_START_OFFSET_SAMPLES
            af.time_base = Fraction(1, rate)
            for pkt in a.encode(af):
                c.mux(pkt)
        for pkt in a.encode():
            c.mux(pkt)
