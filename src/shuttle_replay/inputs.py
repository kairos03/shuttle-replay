# SPDX-License-Identifier: AGPL-3.0-only
"""Strict validation of supplied tracks and reviewed annotations.

Inconsistent inputs raise InputError; nothing is silently reordered,
deduplicated or repaired.
"""

import math

from .calibration import CalibrationError, camera_by_segment

TRACKS_SCHEMA = "shuttle-replay/tracks/v1"
REVIEW_SCHEMA = "shuttle-replay/review/v1"
END_TYPES = ("open", "landing_region")


class InputError(ValueError):
    pass


def _num(x, what):
    if isinstance(x, bool) or not isinstance(x, int | float) or not math.isfinite(x):
        raise InputError(f"{what} must be a finite number")
    return float(x)


def _pair(x, what):
    if not isinstance(x, list | tuple) or len(x) != 2:
        raise InputError(f"{what} must be a pair of numbers")
    return [_num(v, what) for v in x]


def validate_tracks(tracks):
    if tracks.get("schema") != TRACKS_SCHEMA:
        raise InputError(f"tracks schema must be {TRACKS_SCHEMA}")
    frames = tracks.get("frames")
    if not frames:
        raise InputError("tracks contain no frames")
    segments = {}
    prev_id, prev_pts, prev_seg, closed = None, None, None, set()
    for i, f in enumerate(frames):
        fid = f.get("frame_id")
        if not isinstance(fid, int) or isinstance(fid, bool):
            raise InputError(f"frame {i}: frame_id must be an integer")
        if prev_id is not None and fid <= prev_id:
            raise InputError(f"frame_id must be strictly increasing (got {fid} after {prev_id})")
        pts = _num(f.get("pts_s"), f"frame {fid} pts_s")
        if prev_pts is not None and pts <= prev_pts:
            raise InputError(f"source PTS must be strictly increasing at frame {fid}")
        seg = f.get("segment_id")
        if seg != prev_seg:
            if prev_seg is not None:
                closed.add(prev_seg)
            if seg in closed:
                raise InputError(f"segment {seg} is not contiguous: it reappears at frame {fid}")
        if seg is not None:
            s = segments.setdefault(seg, {"segment_id": seg, "first": f, "last": f})
            s["last"] = f
        sh = f.get("shuttle")
        if sh is not None:
            _num(sh.get("u"), f"frame {fid} shuttle.u")
            _num(sh.get("v"), f"frame {fid} shuttle.v")
        for p in f.get("players") or []:
            box = p.get("box")
            if not isinstance(box, list) or len(box) != 4:
                raise InputError(f"frame {fid}: player box must be [x0, y0, x1, y1]")
            for v in box:
                _num(v, f"frame {fid} player box")
        prev_id, prev_pts, prev_seg = fid, pts, seg
    return {
        k: {
            "segment_id": k,
            "start_s": v["first"]["pts_s"],
            "end_s": v["last"]["pts_s"],
            "frame_id_range": [v["first"]["frame_id"], v["last"]["frame_id"]],
        }
        for k, v in segments.items()
    }


def validate_review(review, segments):
    if review.get("schema") != REVIEW_SCHEMA:
        raise InputError(f"review schema must be {REVIEW_SCHEMA}")
    contacts = review.get("contacts") or []
    if not contacts:
        raise InputError("review contains no contacts")
    ids = [c.get("id") for c in contacts]
    if len(set(ids)) != len(ids) or any(not isinstance(i, str) for i in ids):
        raise InputError("contact ids must be unique strings")
    last_t = {}
    for c in contacts:
        cid, seg = c["id"], c.get("segment_id")
        if seg not in segments:
            raise InputError(f"contact {cid}: unknown camera segment {seg}")
        t = _num(c.get("time_s"), f"contact {cid} time_s")
        s = segments[seg]
        if not s["start_s"] <= t <= s["end_s"]:
            raise InputError(f"contact {cid}: time {t} outside camera segment {seg} PTS range")
        lo, hi = _pair(c.get("time_bracket_s"), f"contact {cid} time_bracket_s")
        if not lo <= t <= hi or hi - lo > 0.5:
            raise InputError(f"contact {cid}: time must lie inside a reviewed bracket <= 0.5 s")
        if seg in last_t and t <= last_t[seg]:
            raise InputError(f"contact {cid}: contacts must be strictly increasing in time")
        last_t[seg] = t
        h = _num(c.get("height_m"), f"contact {cid} height_m")
        if not 0.0 < h < 4.0:
            raise InputError(f"contact {cid}: height_m must be within (0, 4) m")
        if _num(c.get("height_sigma_m", 0.3), f"contact {cid} height_sigma_m") <= 0:
            raise InputError(f"contact {cid}: height_sigma_m must be positive")
        if c.get("image_px") is None and c.get("court_xy_m") is None:
            raise InputError(f"contact {cid}: needs reviewed image_px or court_xy_m position")
        if c.get("image_px") is not None:
            _pair(c["image_px"], f"contact {cid} image_px")
        if c.get("court_xy_m") is not None:
            _pair(c["court_xy_m"], f"contact {cid} court_xy_m")
    ordered = sorted(contacts, key=lambda c: (str(c["segment_id"]), c["time_s"]))
    last_of_segment = {c["segment_id"]: c["id"] for c in ordered}
    by_id = {c["id"]: c for c in contacts}
    ends = {}
    for e in review.get("flight_ends") or []:
        cid = e.get("contact_id")
        if cid not in by_id:
            raise InputError(f"flight end refers to unknown contact {cid}")
        if cid in ends:
            raise InputError(f"duplicate flight end for contact {cid}")
        if last_of_segment[by_id[cid]["segment_id"]] != cid:
            raise InputError(
                f"flight end for {cid}: only the last contact of a segment may have an explicit "
                "end; earlier flights end at the next contact"
            )
        if e.get("type") not in END_TYPES:
            raise InputError(f"flight end for {cid}: type must be one of {END_TYPES}")
        if e["type"] == "landing_region":
            lo, hi = _pair(e.get("time_bracket_s"), f"landing {cid} time_bracket_s")
            if not by_id[cid]["time_s"] < lo < hi:
                raise InputError(f"landing {cid}: time bracket must follow the contact")
            reg = e.get("region_xy_m") or {}
            mn, mx = _pair(reg.get("min"), "landing region min"), _pair(reg.get("max"), "max")
            if not (mn[0] < mx[0] and mn[1] < mx[1]):
                raise InputError(f"landing {cid}: region_xy_m min must be below max")
        if e["type"] == "open" and e.get("until_s") is not None:
            until = _num(e["until_s"], f"open flight {cid} until_s")
            seg_end = segments[by_id[cid]["segment_id"]]["end_s"]
            if not by_id[cid]["time_s"] < until <= seg_end:
                raise InputError(
                    f"open flight {cid}: until_s must follow the contact within its segment"
                )
        ends[cid] = e
    return ends


def validate_inputs(tracks, review, calibration):
    segments = validate_tracks(tracks)
    try:
        cams = camera_by_segment(calibration)
    except CalibrationError as exc:
        raise InputError(str(exc)) from exc
    missing = [s for s in segments if s not in cams]
    if missing:
        raise InputError(f"no calibration for camera segment(s) {missing}")
    ends = validate_review(review, segments)
    return segments, cams, ends
