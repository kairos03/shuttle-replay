# SPDX-License-Identifier: AGPL-3.0-only
"""Command-line interface: calibrate, analyze, render, run, demo."""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from . import __version__
from .analysis import analyze
from .calibration import CalibrationError, calibrate
from .inputs import InputError
from .render import RenderError, render


def _load(path):
    return json.loads(Path(path).read_text())


def _json_default(o):
    if isinstance(o, np.generic):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(f"not JSON serializable: {type(o).__name__}")


class OutputError(ValueError):
    pass


def _refuse_existing(*paths):
    """v0.1 output policy: never overwrite (this also protects any input at that path)."""
    for p in paths:
        p = Path(p)
        if p.exists() or p.is_symlink():
            raise OutputError(f"output already exists: {p} (v0.1 never overwrites)")


def _dump(obj, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, indent=2, ensure_ascii=False, default=_json_default)
    try:
        with open(path, "x", encoding="utf-8") as f:
            f.write(text)
    except FileExistsError as exc:
        raise OutputError(f"output already exists: {path} (v0.1 never overwrites)") from exc


PIPELINE_OUTPUTS = ("analysis.json", "replay.mp4", "render_report.json")


def _run_pipeline(video, tracks, review, calibration, out_dir):
    out_dir = Path(out_dir)
    _refuse_existing(*(out_dir / n for n in PIPELINE_OUTPUTS))
    result = analyze(tracks, review, calibration)
    # Render first: JSON results are written only after a verified video exists.
    report = render(video, result, out_dir / "replay.mp4")
    _dump(result, out_dir / "analysis.json")
    _dump(report, out_dir / "render_report.json")
    return result, report


def _summary(result, report):
    return {
        "synthetic": result["synthetic"],
        "flights": [
            {
                "id": f["id"],
                "status": f.get("status"),
                "end_type": f["end_type"],
                "model_speed_coarse_km_h": f.get("model_speed_coarse_km_h"),
            }
            for f in result["flights"]
        ],
        "video": report["output"],
        "frames": report["frames_written"],
        "audio_preserved": report["audio"]["preserved"],
    }


def cmd_calibrate(a):
    _refuse_existing(a.output)
    _dump(calibrate(_load(a.input)), a.output)
    print(json.dumps({"calibration": str(a.output)}))


def cmd_analyze(a):
    _refuse_existing(a.output)
    result = analyze(_load(a.tracks), _load(a.review), _load(a.calibration))
    _dump(result, a.output)
    print(json.dumps({"analysis": str(a.output), "flights": len(result["flights"])}))


def cmd_render(a):
    report_path = a.report or Path(a.output).with_suffix(".report.json")
    _refuse_existing(report_path)
    report = render(a.video, _load(a.analysis), a.output)
    _dump(report, report_path)
    print(json.dumps({"video": str(a.output), "audio_preserved": report["audio"]["preserved"]}))


def cmd_run(a):
    result, report = _run_pipeline(
        a.video, _load(a.tracks), _load(a.review), _load(a.calibration), a.out_dir
    )
    print(json.dumps(_summary(result, report), indent=2))


def cmd_demo(a):
    from .synthetic import build_scene

    out = Path(a.out_dir)
    if out.exists() and any(out.iterdir()):
        raise OutputError(f"demo output directory is not empty: {out} (v0.1 never overwrites)")
    paths, truth = build_scene(out / "inputs")
    cal = calibrate(_load(paths["calibration_input"]))
    _dump(cal, out / "calibration.json")
    result, report = _run_pipeline(
        paths["video"], _load(paths["tracks"]), _load(paths["review"]), cal, out
    )
    true_by_contact = {f["contact"]: f for f in truth["flights"]}
    rows = []
    for f in result["flights"]:
        t = true_by_contact[f["contact_id"]]
        row = {
            "flight": f["id"],
            "status": f.get("status"),
            "model_speed_km_h": f.get("model_speed_km_h"),
            "true_speed_km_h": t["speed_km_h"],
        }
        if f.get("params"):
            row["start_position_error_m"] = float(
                np.linalg.norm(np.array(f["params"][:3]) - t["params"][:3])
            )
        if f.get("landing"):
            row["landing_xy_error_m"] = float(
                np.linalg.norm(np.array(f["landing"]["xy_m"]) - truth["c5_landing_xy_m"])
            )
        rows.append(row)
    _dump(
        {
            "label": "SYNTHETIC ground-truth recovery; not evidence of accuracy on real video",
            "flights": rows,
            "calibration_heldout": [s["heldout_summary"] for s in cal["segments"]],
        },
        out / "synthetic_recovery.json",
    )
    print(json.dumps(_summary(result, report), indent=2))


def build_parser():
    p = argparse.ArgumentParser(
        prog="shuttle-replay",
        description="Offline, review-driven badminton shuttle replay from supplied detections. "
        "Calibrate a camera, fit physics-constrained flights, render a replay MP4.",
    )
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("calibrate", help="camera calibration from reviewed correspondences")
    s.add_argument("input", help="calibration input JSON (ground points + net anchors)")
    s.add_argument("-o", "--output", required=True)
    s.set_defaults(func=cmd_calibrate)

    s = sub.add_parser("analyze", help="fit flights from supplied tracks and review annotations")
    s.add_argument("--tracks", required=True)
    s.add_argument("--review", required=True)
    s.add_argument("--calibration", required=True)
    s.add_argument("-o", "--output", required=True)
    s.set_defaults(func=cmd_analyze)

    s = sub.add_parser("render", help="render replay MP4 from a local video and analysis JSON")
    s.add_argument("--video", required=True)
    s.add_argument("--analysis", required=True)
    s.add_argument("-o", "--output", required=True)
    s.add_argument("--report", help="render report JSON path (default: <output>.report.json)")
    s.set_defaults(func=cmd_render)

    s = sub.add_parser("run", help="analyze + render in one step")
    for name in ("video", "tracks", "review", "calibration"):
        s.add_argument(f"--{name}", required=True)
    s.add_argument("--out-dir", required=True)
    s.set_defaults(func=cmd_run)

    s = sub.add_parser("demo", help="self-contained synthetic demo (no real footage, no weights)")
    s.add_argument("--out-dir", required=True)
    s.set_defaults(func=cmd_demo)
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        args.func(args)
    except (
        InputError,
        CalibrationError,
        RenderError,
        OutputError,
        FileNotFoundError,
        json.JSONDecodeError,
    ) as exc:
        print(f"shuttle-replay: error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
