# SPDX-License-Identifier: AGPL-3.0-only
import copy
import json
import shutil
import subprocess
import sys

import pytest

from shuttle_replay.render import RenderError, render, trail_for, verify_mp4
from shuttle_replay.synthetic import IMAGE_SIZE, N_FRAMES, SEGMENTS


def _cli(*args, check=True):
    return subprocess.run(
        [sys.executable, "-m", "shuttle_replay", *map(str, args)],
        capture_output=True,
        text=True,
        check=check,
    )


def test_cli_help_lists_commands():
    out = _cli("--help").stdout
    for cmd in ("calibrate", "analyze", "render", "run", "demo"):
        assert cmd in out
    assert "detector" not in out.lower()


def test_demo_end_to_end_creates_verified_artifacts(tmp_path):
    res = _cli("demo", "--out-dir", tmp_path)
    summary = json.loads(res.stdout)
    assert summary["synthetic"] is True
    for name in (
        "calibration.json",
        "analysis.json",
        "replay.mp4",
        "render_report.json",
        "synthetic_recovery.json",
    ):
        assert (tmp_path / name).stat().st_size > 0
    check = verify_mp4(tmp_path / "replay.mp4")
    assert check["video_frames_decoded"] == N_FRAMES
    w, h = IMAGE_SIZE
    assert (check["width"], check["height"]) == (w + round(w * 4 / 6 / 2) * 2, h)
    assert check["audio_samples_decoded"] > 0
    report = json.loads((tmp_path / "render_report.json").read_text())
    assert report["audio"]["preserved"] is True
    assert report["pts_check"]["max_abs_diff_s"] < 1e-3
    assert report["layout"]["source_aspect_preserved"] is True
    recovery = json.loads((tmp_path / "synthetic_recovery.json").read_text())
    assert recovery["label"].startswith("SYNTHETIC")


def test_render_rejects_mismatched_pts_and_handles_hostile_filename(scene, analysis, tmp_path):
    hostile = tmp_path / "-x; rm -rf $(echo nope) 'q'.mp4"
    shutil.copy(scene["paths"]["video"], hostile)
    bad = copy.deepcopy(analysis)
    bad["frames"][20]["pts_s"] += 0.01
    with pytest.raises(RenderError, match="PTS"):
        render(hostile, bad, tmp_path / "bad.mp4")
    short = copy.deepcopy(analysis)
    short["frames"] = short["frames"][:-1]
    with pytest.raises(RenderError, match="frame count"):
        render(hostile, short, tmp_path / "short.mp4")
    assert hostile.exists()


def test_trails_stay_inside_one_flight_and_segment(analysis):
    frames = analysis["frames"]
    assert trail_for(frames, SEGMENTS[1][0]) == []
    for i, r in enumerate(frames):
        trail = trail_for(frames, i)
        if r["model_flight_id"] is None:
            assert trail == []
            continue
        sources = [
            frames[j]
            for j in range(i + 1)
            if frames[j]["shuttle_model_xyz_m"] and frames[j]["shuttle_model_xyz_m"][:2] in trail
        ]
        assert {(s["model_flight_id"], s["segment_id"]) for s in sources} == {
            (r["model_flight_id"], r["segment_id"])
        }


def test_run_command_from_existing_inputs(scene, tmp_path):
    p = scene["paths"]
    cal = tmp_path / "calibration.json"
    _cli("calibrate", p["calibration_input"], "-o", cal)
    out = tmp_path / "run"
    _cli(
        "run",
        "--video",
        p["video"],
        "--tracks",
        p["tracks"],
        "--review",
        p["review"],
        "--calibration",
        cal,
        "--out-dir",
        out,
    )
    assert verify_mp4(out / "replay.mp4")["video_frames_decoded"] == N_FRAMES
    bad = _cli(
        "analyze",
        "--tracks",
        p["review"],
        "--review",
        p["review"],
        "--calibration",
        cal,
        "-o",
        tmp_path / "x.json",
        check=False,
    )
    assert bad.returncode == 2 and "schema" in bad.stderr
