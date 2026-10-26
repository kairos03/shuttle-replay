# SPDX-License-Identifier: AGPL-3.0-only
import copy

import pytest

from shuttle_replay.inputs import InputError, validate_inputs


def _frames(t):
    return t["frames"]


CASES = [
    ("non-monotonic PTS", lambda t, r: _frames(t)[10].__setitem__("pts_s", 0.0), "PTS"),
    ("non-finite PTS", lambda t, r: _frames(t)[10].__setitem__("pts_s", float("nan")), "finite"),
    ("duplicate frame id", lambda t, r: _frames(t)[11].__setitem__("frame_id", 10), "frame_id"),
    ("segment reappears", lambda t, r: _frames(t)[82].__setitem__("segment_id", 0), "contiguous"),
    (
        "contact outside segment",
        lambda t, r: r["contacts"][3].update(time_s=2.7, time_bracket_s=[2.68, 2.72]),
        "segment",
    ),
    (
        "time outside bracket",
        lambda t, r: r["contacts"][1].__setitem__("time_bracket_s", [1.0, 1.1]),
        "bracket",
    ),
    (
        "unordered contacts",
        lambda t, r: r["contacts"][1].update(time_s=0.1, time_bracket_s=[0.05, 0.15]),
        "increasing",
    ),
    (
        "end on non-terminal contact",
        lambda t, r: r["flight_ends"][0].__setitem__("contact_id", "c2"),
        "last contact",
    ),
    ("contact without position", lambda t, r: r["contacts"][0].pop("image_px"), "image_px"),
    (
        "bad landing region",
        lambda t, r: r["flight_ends"][1]["region_xy_m"].__setitem__("max", [0.0, 0.0]),
        "region",
    ),
    ("bad height", lambda t, r: r["contacts"][0].__setitem__("height_m", -1.0), "height"),
]


@pytest.mark.parametrize("name, mutate, message", CASES, ids=[c[0] for c in CASES])
def test_inconsistent_inputs_are_rejected_not_repaired(scene, name, mutate, message):
    tracks, review = copy.deepcopy(scene["tracks"]), copy.deepcopy(scene["review"])
    mutate(tracks, review)
    with pytest.raises(InputError, match=message):
        validate_inputs(tracks, review, scene["calibration"])


def test_missing_segment_calibration_is_rejected(scene):
    cal = copy.deepcopy(scene["calibration"])
    cal["segments"] = cal["segments"][:1]
    with pytest.raises(InputError, match="calibration"):
        validate_inputs(scene["tracks"], scene["review"], cal)
