# SPDX-License-Identifier: AGPL-3.0-only
"""Regressions from independent review: output safety, A/V timing, net gate, court lines."""

import hashlib
import itertools
import json
import os
import subprocess
import sys
from fractions import Fraction

import av
import numpy as np
import pytest
from PIL import Image

from shuttle_replay.court import COURT_LENGTH_M, COURT_WIDTH_M, court_lines
from shuttle_replay.physics import physical_gates
from shuttle_replay.render import RenderError, render


def _sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _video(path, n=6, audio_start_s=None, audio_gap=None):
    """Tiny source; optional AAC audio starting at audio_start_s with an optional gap."""
    with av.open(str(path), "w") as c:
        v = c.add_stream("mpeg4", rate=30)
        v.width, v.height, v.pix_fmt = 96, 64, "yuv420p"
        a = None
        if audio_start_s is not None:
            a = c.add_stream("aac", rate=48000)
            a.layout = "mono"
        for i in range(n):
            f = av.VideoFrame.from_image(Image.new("RGB", (96, 64), (i * 30, 0, 0)))
            f.pts, f.time_base = i, Fraction(1, 30)
            for q in v.encode(f):
                c.mux(q)
        for q in v.encode():
            c.mux(q)
        if a is not None:
            fs = 1024
            start = int(audio_start_s * 48000)
            pos = start
            for j in range(10):
                if audio_gap and j == audio_gap[0]:
                    pos += audio_gap[1]
                tone = (0.2 * np.sin(np.arange(pos, pos + fs) * 0.05)).astype(np.float32)
                af = av.AudioFrame.from_ndarray(tone[None, :], format="fltp", layout="mono")
                af.sample_rate, af.pts, af.time_base = 48000, pos, Fraction(1, 48000)
                for q in a.encode(af):
                    c.mux(q)
                pos += fs
            for q in a.encode():
                c.mux(q)


def _analysis(path):
    with av.open(str(path)) as c:
        ts = [float(f.time) for f in c.decode(video=0)]
    frames = [
        dict(frame_id=i, pts_s=t, segment_id=None, model_flight_id=None, shuttle_model_xyz_m=None)
        for i, t in enumerate(ts)
    ]
    return {"flights": [], "frames": frames}


def _first_times(path):
    out = {}
    with av.open(str(path)) as c:
        for pkt in c.demux():
            for f in pkt.decode():
                out.setdefault(pkt.stream.type, f.time)
    return out


def test_render_never_overwrites_source_or_existing_files(tmp_path):
    src = tmp_path / "src.mp4"
    _video(src)
    a = _analysis(src)
    before = _sha(src)
    link = tmp_path / "link.mp4"
    link.symlink_to(src)
    hard = tmp_path / "hard.mp4"
    os.link(src, hard)
    for target in (src, link, hard):
        with pytest.raises(RenderError, match="source|exists"):
            render(src, a, target)
    assert _sha(src) == before
    # Existing unrelated output and old-style staging names are never touched.
    prev = tmp_path / "out.mp4"
    prev.write_bytes(b"PREVIOUS GOOD OUTPUT")
    with pytest.raises(RenderError, match="exists"):
        render(src, a, prev)
    assert prev.read_bytes() == b"PREVIOUS GOOD OUTPUT"
    stage = tmp_path / "new.partial.mp4"
    stage.write_bytes(b"UNRELATED")
    bad = json.loads(json.dumps(a))
    bad["frames"][0]["pts_s"] = 9.0
    with pytest.raises(RenderError, match="PTS"):
        render(src, bad, tmp_path / "new.mp4")
    assert stage.read_bytes() == b"UNRELATED"
    assert not (tmp_path / "new.mp4").exists()
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(
        ["src.mp4", "link.mp4", "hard.mp4", "out.mp4", "new.partial.mp4"]
    )
    assert _sha(src) == before


def test_cli_rejects_output_aliasing_inputs(tmp_path):
    src = tmp_path / "src.mp4"
    _video(src)
    an = tmp_path / "analysis.json"
    an.write_text(json.dumps(_analysis(src)))
    before = (_sha(src), _sha(an))

    def cli(*args):
        return subprocess.run(
            [sys.executable, "-m", "shuttle_replay", *map(str, args)],
            capture_output=True,
            text=True,
        )

    r = cli("render", "--video", src, "--analysis", an, "-o", src)
    assert r.returncode == 2 and r.stdout == ""
    # run must not overwrite a supplied input that sits at <out-dir>/analysis.json.
    tr = tmp_path / "t.json"
    tr.write_text("{}")
    r = cli(
        "run",
        "--video",
        src,
        "--tracks",
        tr,
        "--review",
        tr,
        "--calibration",
        an,
        "--out-dir",
        tmp_path,
    )
    assert r.returncode == 2 and r.stdout == ""
    assert (_sha(src), _sha(an)) == before


def test_audio_is_stream_copied_with_source_relative_offset(tmp_path):
    src = tmp_path / "delayed.mp4"
    _video(src, n=30, audio_start_s=0.378, audio_gap=(5, 4800))
    out = tmp_path / "replay.mp4"
    report = render(src, _analysis(src), out)
    s, o = _first_times(src), _first_times(out)
    assert s["audio"] > 0.3
    assert abs((o["audio"] - o["video"]) - (s["audio"] - s["video"])) < 1e-3
    audio = report["audio"]
    assert audio["preserved"] is True and audio["method"].startswith("stream copy")
    assert abs(audio["output_first_audio_s"] - audio["source_first_audio_s"]) < 1e-3

    def apts(p):
        with av.open(str(p)) as c:
            st = c.streams.audio[0]
            return [float(k.pts * st.time_base) for k in c.demux(st) if k.pts is not None]

    assert apts(src) == pytest.approx(apts(out), abs=1e-4)  # gap preserved packet-for-packet


def test_actual_low_net_crossing_rejected_without_expected_crossing():
    low = np.array([[3.0, 8.0, 1.2], [3.0, 6.7, 0.93], [3.0, 5.6, 0.6]])
    g = physical_gates(low, crosses_net=False)
    assert g["net_crossing_occurred"] and not g["net_crossing_required"]
    assert not g["net_ok"]
    high = low.copy()
    high[:, 2] += 1.0
    assert physical_gates(high, crosses_net=False)["net_ok"]
    stays = np.array([[3.0, 8.0, 1.2], [3.0, 7.5, 0.9]])
    g = physical_gates(stays, crosses_net=False)
    assert g["net_ok"] and not g["net_crossing_occurred"]


def test_court_lines_are_line_centres_of_40mm_lines_inside_outer_boundary():
    xs = sorted({round(v, 3) for a, b in court_lines() for v in (a[0], b[0])})
    ys = sorted({round(v, 3) for a, b in court_lines() for v in (a[1], b[1])})
    assert xs[0] == 0.02 and xs[-1] == round(COURT_WIDTH_M - 0.02, 3)
    assert ys[0] == 0.02 and ys[-1] == round(COURT_LENGTH_M - 0.02, 3)
    # Reviewed calibration convention: singles 0.48/5.62, short service 4.70/8.70,
    # doubles long service 0.78/12.62 (all line centres).
    assert {0.48, 5.62, 3.05} <= set(xs)
    assert {0.78, 4.70, 8.70, 12.62} <= set(ys)
    pts = set()
    for (a, b), (c, d) in itertools.combinations(court_lines(), 2):
        if a[0] == b[0] and c[1] == d[1]:
            pts.add((round(a[0], 3), round(c[1], 3)))
    assert (0.48, 0.78) in pts  # single_left x long_far intersection used in calibration
