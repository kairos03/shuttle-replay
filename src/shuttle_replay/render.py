# SPDX-License-Identifier: AGPL-3.0-only
"""Replay rendering: source video panel (original aspect, unscaled) + top-view panel, 6:4.

Decoding, encoding and audio muxing use PyAV in-process; no shell commands are
built from file names. Each decoded source frame is matched to the analysis
frame with the same decode index and its PTS is verified before drawing.
"""

import math
import os
import tempfile
from fractions import Fraction
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw

from .court import COURT_LENGTH_M, COURT_WIDTH_M, NET_Y_M, court_lines


class RenderError(RuntimeError):
    pass


OBSERVED = (60, 230, 90)
MODEL = (255, 150, 30)
REVIEW = (120, 190, 255)
PLAYER = {"near": (90, 160, 255), "far": (255, 90, 120)}


def _even(x):
    return int(math.ceil(x / 2) * 2)


def trail_for(frames, i):
    """Model XY samples of the flight shown at frame i (same flight => same segment)."""
    fid = frames[i]["model_flight_id"]
    if fid is None:
        return []
    pts = []
    for j in range(i, -1, -1):
        if frames[j]["model_flight_id"] != fid:
            break
        pts.append(frames[j]["shuttle_model_xyz_m"][:2])
    return pts[::-1]


class TopView:
    def __init__(self, x0, width, height, margin=24):
        self.x0, self.w, self.h = x0, width, height
        self.s = min(
            (width - 2 * margin) / COURT_WIDTH_M, (height - 2 * margin - 16) / COURT_LENGTH_M
        )
        self.ox = x0 + (width - self.s * COURT_WIDTH_M) / 2
        self.oy = 16 + (height - 16 - self.s * COURT_LENGTH_M) / 2

    def px(self, xy):
        return (self.ox + self.s * xy[0], self.oy + self.s * xy[1])

    def draw_court(self, d):
        d.rectangle([self.x0, 0, self.x0 + self.w, self.h], fill=(24, 70, 52))
        for a, b in court_lines():
            d.line([self.px(a), self.px(b)], fill=(230, 230, 230), width=1)
        d.line(
            [self.px((-0.2, NET_Y_M)), self.px((COURT_WIDTH_M + 0.2, NET_Y_M))],
            fill=(255, 255, 255),
            width=3,
        )


def _ring(d, uv, r, color, width=2):
    u, v = uv
    d.ellipse([u - r, v - r, u + r, v + r], outline=color, width=width)


def _open_encoder(out, tb, w, h):
    errors = []
    for name in ("libx264", "h264", "mpeg4"):
        try:
            vs = out.add_stream(name, rate=30)
            vs.width, vs.height, vs.pix_fmt = w, h, "yuv420p"
            etb = tb if (name != "mpeg4" or tb.denominator <= 65535) else Fraction(1, 60000)
            vs.codec_context.time_base = etb
            vs.time_base = etb
            vs.codec_context.open()
            return vs, name, etb
        except Exception as exc:  # pragma: no cover - depends on local FFmpeg build
            errors.append(f"{name}: {exc}")
    raise RenderError("no usable H.264/MPEG-4 encoder: " + "; ".join(errors))


def _check_paths(video_path, out_path):
    if not video_path.is_file():
        raise RenderError(f"source video not found: {video_path.name}")
    if out_path.resolve() == video_path.resolve() or (
        out_path.exists() and os.path.samefile(out_path, video_path)
    ):
        raise RenderError("output path aliases the source video; refusing to overwrite source")
    if out_path.exists() or out_path.is_symlink():
        raise RenderError(f"output already exists: {out_path.name} (v0.1 never overwrites)")


def _first_times(path):
    """First decoded timestamp per stream type."""
    out = {}
    with av.open(str(path)) as c:
        for packet in c.demux():
            if packet.stream.type in out:
                continue
            for fr in packet.decode():
                if fr.time is not None:
                    out[packet.stream.type] = float(fr.time)
                    break
            if len(out) == len(c.streams):
                break
    return out


def _audio_packet_times(path):
    with av.open(str(path)) as c:
        if not c.streams.audio:
            return []
        st = c.streams.audio[0]
        return [float(p.pts * st.time_base) for p in c.demux(st) if p.pts is not None]


def render(video_path, analysis, out_path, pts_tolerance_s=1e-3):
    """Render a replay MP4 and return a report dict.

    The output must not exist and must not alias the source (v0.1 never overwrites).
    Rendering goes to a unique staging file next to the output, which is fully
    verified before it is linked into place; on failure only that staging file is
    removed. Source audio packets are stream-copied unchanged, keeping their timing.
    """
    video_path, out_path = Path(video_path), Path(out_path)
    _check_paths(video_path, out_path)
    frames = analysis["frames"]
    flights = {f["id"]: f for f in analysis["flights"]}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{out_path.stem}.", suffix=".staging.mp4", dir=out_path.parent
    )
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        inp = av.open(str(video_path))
        try:
            vin = inp.streams.video[0]
            ain = inp.streams.audio[0] if inp.streams.audio else None
            sw, sh = vin.codec_context.width, vin.codec_context.height
            W, H = _even(sw), _even(sh)
            tw = 2 * round(W * 4 / 6 / 2)
            top = TopView(W, tw, H)
            out = av.open(str(tmp), "w", format="mp4")
            vs, vcodec, etb = _open_encoder(out, vin.time_base, W + tw, H)
            aout = None
            if ain is not None:
                try:
                    aout = out.add_stream_from_template(ain)
                except Exception as exc:
                    raise RenderError(
                        f"source audio ({ain.codec_context.name}) cannot be stream-copied "
                        f"into MP4: {exc}"
                    ) from exc
            audio_packets = 0
            k = 0
            max_diff = 0.0
            landing_shown = {}
            streams = [vin] + ([ain] if ain is not None else [])
            for packet in inp.demux(*streams):
                if packet.stream.type == "audio":
                    if packet.dts is None:
                        continue
                    packet.stream = aout
                    try:
                        out.mux(packet)
                    except Exception as exc:
                        raise RenderError(f"source audio cannot be stream-copied: {exc}") from exc
                    audio_packets += 1
                    continue
                for frame in packet.decode():
                    if k >= len(frames):
                        raise RenderError(
                            "frame count mismatch: video has more frames than analysis"
                        )
                    rec = frames[k]
                    if rec["frame_id"] != k:
                        raise RenderError(f"frame_id {rec['frame_id']} != decode index {k}")
                    if frame.time is None:
                        raise RenderError(f"source frame {k} has no PTS")
                    diff = abs(float(frame.time) - rec["pts_s"])
                    max_diff = max(max_diff, diff)
                    if diff > pts_tolerance_s:
                        raise RenderError(
                            f"PTS mismatch at frame {k}: video {frame.time:.6f}s vs tracks "
                            f"{rec['pts_s']:.6f}s"
                        )
                    img = _compose(
                        frame.to_image(),
                        rec,
                        frames,
                        k,
                        flights,
                        top,
                        W,
                        H,
                        tw,
                        landing_shown,
                        analysis.get("synthetic", False),
                    )
                    vf = av.VideoFrame.from_image(img)
                    vf.pts = int(round(float(frame.pts * frame.time_base) / etb))
                    vf.time_base = etb
                    for p in vs.encode(vf):
                        out.mux(p)
                    k += 1
            if k != len(frames):
                raise RenderError(f"frame count mismatch: video {k} vs analysis {len(frames)}")
            for p in vs.encode():
                out.mux(p)
            out.close()
        finally:
            inp.close()

        check = verify_mp4(tmp)
        if check["video_frames_decoded"] != len(frames):
            raise RenderError("output frame count does not match source")
        audio = {"source_has_audio": ain is not None, "preserved": False}
        if ain is None:
            audio["method"] = "source has no audio stream; output is silent"
        else:
            src_t, out_t = _first_times(video_path), _first_times(tmp)
            src_off = src_t["audio"] - src_t["video"]
            out_off = out_t["audio"] - out_t["video"]
            if abs(out_off - src_off) > 1e-3:
                raise RenderError(
                    f"audio timing not preserved: source A/V offset {src_off:.6f}s, "
                    f"output {out_off:.6f}s"
                )
            if _audio_packet_times(tmp) != _audio_packet_times(video_path):
                raise RenderError("audio packet timestamps changed during stream copy")
            audio.update(
                preserved=True,
                method="stream copy (source audio packets remuxed unchanged, no re-encoding)",
                codec=ain.codec_context.name,
                packets_copied=audio_packets,
                source_first_audio_s=src_t["audio"],
                output_first_audio_s=out_t["audio"],
                source_first_video_s=src_t["video"],
                output_first_video_s=out_t["video"],
                av_offset_error_s=abs(out_off - src_off),
            )
        try:
            os.link(tmp, out_path)  # atomic no-clobber publish of the verified file
        except FileExistsError as exc:
            raise RenderError(f"output appeared during rendering: {out_path.name}") from exc
    finally:
        tmp.unlink(missing_ok=True)
    return {
        "output": out_path.name,
        "source_video": video_path.name,
        "video_codec": vcodec,
        "frames_written": k,
        "timing": "output frame PTS copied from source PTS (variable frame rate preserved)",
        "pts_check": {"tolerance_s": pts_tolerance_s, "max_abs_diff_s": max_diff},
        "layout": {
            "source_panel_px": [W, H],
            "top_view_panel_px": [tw, H],
            "ratio": "6:4 (source:top view)",
            "source_scale": 1.0,
            "source_aspect_preserved": (W, H) == (sw, sh) or abs(W / H - sw / sh) < 0.01,
        },
        "audio": audio,
        "verification": check,
        "output_policy": "fail if output exists or aliases the source; verified before publish",
        "drawing": "trails connect model samples of one flight only (display_interpolation); "
        "camera-cut frames carry no shuttle overlay",
    }


def _compose(src, rec, frames, k, flights, top, W, H, tw, landing_shown, synthetic):
    canvas = Image.new("RGB", (W + tw, H), (0, 0, 0))
    canvas.paste(src, (0, 0))
    d = ImageDraw.Draw(canvas)
    top.draw_court(d)
    title = "TOP VIEW (conditional model)" + ("  SYNTHETIC" if synthetic else "")
    d.text((W + 6, 2), title, fill=(255, 255, 255))
    seg = rec["segment_id"]
    if seg is None:
        d.text((8, 8), "camera cut: excluded from replay", fill=(255, 255, 0))
        return canvas
    for p in rec.get("players") or []:
        x0, y0, x1, y1 = p["box"]
        d.rectangle([x0, y0, x1, y1], outline=PLAYER.get(p.get("label"), (200, 200, 200)), width=1)
    if rec["shuttle_observed_px"] is not None:
        _ring(d, rec["shuttle_observed_px"], 7, OBSERVED)
    if rec["shuttle_model_px"] is not None:
        _ring(d, rec["shuttle_model_px"], 11, MODEL, 2)
    d.text((8, 8), "green: observed detection  orange: conditional model", fill=(255, 255, 255))
    trail = trail_for(frames, k)
    if len(trail) > 1:
        d.line([top.px(p) for p in trail], fill=MODEL, width=2)
    if rec["shuttle_model_xyz_m"] is not None:
        x, y, z = rec["shuttle_model_xyz_m"]
        u, v = top.px((x, y))
        r = 4 + 2 * max(z, 0)
        d.ellipse([u - r, v - r, u + r, v + r], fill=MODEL)
        f = flights[rec["model_flight_id"]]
        d.text((W + 6, H - 30), f"z = {z:.1f} m (model)", fill=(255, 255, 255))
        d.text(
            (W + 6, H - 16),
            f"~{f['model_speed_coarse_km_h']} km/h model initial speed",
            fill=(255, 255, 255),
        )
    for f in flights.values():
        land = f.get("landing")
        if f["segment_id"] != seg or not land or rec["pts_s"] < f["t0_s"]:
            continue
        reg = land["region_xy_m"]
        a, b = top.px(reg["min"]), top.px(reg["max"])
        for i in range(0, 4):
            pts = [(a[0], a[1]), (b[0], a[1]), (b[0], b[1]), (a[0], b[1])]
            p0, p1 = np.array(pts[i]), np.array(pts[(i + 1) % 4])
            for s in np.arange(0, 1, 0.2):
                d.line(
                    [tuple(p0 + (p1 - p0) * s), tuple(p0 + (p1 - p0) * (s + 0.1))],
                    fill=REVIEW,
                    width=1,
                )
        if rec["pts_s"] >= land["time_s"]:
            u, v = top.px(land["xy_m"])
            d.line([(u - 5, v - 5), (u + 5, v + 5)], fill=MODEL, width=2)
            d.line([(u - 5, v + 5), (u + 5, v - 5)], fill=MODEL, width=2)
            d.text((W + 6, 16), "landing: reviewed region + model (not measured)", fill=REVIEW)
    return canvas


def verify_mp4(path):
    """Fully decode an MP4 and report what is actually inside."""
    with av.open(str(path)) as c:
        v = c.streams.video[0]
        width, height = v.codec_context.width, v.codec_context.height
        has_audio = bool(c.streams.audio)
        nv, na, last = 0, 0, None
        streams = [v] + ([c.streams.audio[0]] if has_audio else [])
        for packet in c.demux(*streams):
            for fr in packet.decode():
                if packet.stream.type == "video":
                    nv += 1
                    last = fr.time
                else:
                    na += fr.samples
    return {
        "video_frames_decoded": nv,
        "width": width,
        "height": height,
        "last_video_pts_s": last,
        "audio_stream": has_audio,
        "audio_samples_decoded": na,
    }
