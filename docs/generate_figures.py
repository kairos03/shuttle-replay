"""Generate the localized technical figures under docs/assets/technical/.

Six SVG figures per documentation language plus one shared JSON file with the
numerical evidence behind the two graphs:

    docs/assets/technical/<lang>/{pipeline,court,render-pipeline,render-layout,
                                  trajectory,speed}.svg
    docs/assets/technical/physics-example.json

The SVGs are written as plain text with the standard library (no plotting
package). Geometry comes from the package itself: court lines from
``shuttle_replay.court``, the 6:4 panel sizes from ``shuttle_replay.render``,
and the graph series from ``shuttle_replay.physics.simulate`` /
``floor_crossing`` for a chosen synthetic initial state. Labels come from
``docs/figure_labels.json``.

    uv run python docs/generate_figures.py           # write all outputs
    uv run python docs/generate_figures.py --check   # regenerate in memory, compare
"""

import argparse
import hashlib
import json
import math
import sys
import unicodedata
from html import escape
from pathlib import Path

DOCS = Path(__file__).resolve().parent
ROOT = DOCS.parent
sys.path.insert(0, str(ROOT / "src"))

import numpy as np  # noqa: E402
from scipy.integrate import solve_ivp  # noqa: E402

from shuttle_replay import physics  # noqa: E402
from shuttle_replay.court import (  # noqa: E402
    COURT_LENGTH_M,
    COURT_WIDTH_M,
    NET_CENTRE_HEIGHT_M,
    NET_POST_HEIGHT_M,
    NET_Y_M,
    court_lines,
)
from shuttle_replay.render import TopView, _even  # noqa: E402

OUT = DOCS / "assets" / "technical"
LABELS = DOCS / "figure_labels.json"
LANGS = ["en", "zh", "ja", "ru", "ko", "es", "fr", "de", "pt-BR", "it"]
FIGURES = ["pipeline", "court", "render-pipeline", "render-layout", "trajectory", "speed"]

# Palette (docs contract): off-white canvas, court green, neutral text,
# orange model, blue review constraint.
BG = "#fbfbf8"
GREEN = "#1f6b45"
TEXT = "#20312b"
ORANGE = "#ce7317"
BLUE = "#367ca5"
MUTED = "#5d6b65"
GRID = "#dfe5e1"
FILE_FILL = "#ffffff"
PANEL = "#eef1ee"
BOLD = 1.1  # bold glyphs are wider; measure bold text at this factor

# Synthetic example for the graphs. Chosen by hand, not fitted to anything:
# a high shot from the near half towards the far half of the court.
GRAVITY = 9.81
START_STATE = [2.0, 11.6, 2.5, 0.3, -14.0, 8.0]  # x, y, z (m), vx, vy, vz (m/s)
K_DRAG = 0.18  # 1/m, the analysis prior
K_IDEAL = 0.0
SAMPLES = 121
DIGITS = 9  # stored and plotted series are rounded to this many decimals

# Example source size for the layout figure.
EXAMPLE_SOURCE = (1920, 1080)


# --------------------------------------------------------------------------- text


def _wide(ch):
    return unicodedata.east_asian_width(ch) in "WF"


_NO_START = set("、。，．：；！？）」』】〕ー,.:;!?)")
_NO_END = set("（「『【〔(")


def char_width(ch):
    """Rough advance width in em for a sans-serif face (deliberately generous)."""
    if _wide(ch):
        return 1.0
    if ch == " ":
        return 0.30
    if ch in "il.,:;|!'()[]/":
        return 0.32
    if ch in "mwMW":
        return 0.88
    if ch.isupper():
        return 0.68
    if "\u0400" <= ch <= "\u04ff":
        return 0.62
    return 0.57


def text_width(s, size):
    return sum(char_width(c) for c in s) * size


def _units(s):
    """Unbreakable units as (text, space_before)."""
    units, buf, space = [], "", False

    def flush():
        nonlocal buf, space
        if buf:
            units.append((buf, space))
            buf, space = "", False

    for i, ch in enumerate(s):
        if ch == " ":
            flush()
            space = True
            continue
        if _wide(ch) and ch not in _NO_START and buf and buf[-1] not in _NO_END:
            flush()
        elif buf and _wide(buf[-1]) and ch not in _NO_START and buf[-1] not in _NO_END:
            flush()
        buf += ch
        nxt = s[i + 1] if i + 1 < len(s) else ""
        if ch == "-" and len(buf) > 1 and buf[-2].isalpha() and nxt.isalpha():
            flush()
    flush()
    return units


def wrap(s, max_w, size, max_lines=4):
    lines, cur, cur_w = [], "", 0.0
    for text, space in _units(s):
        w = text_width(text, size)
        if w > max_w:
            raise ValueError(f"unbreakable text {text!r} wider than {max_w}px at {size}px")
        add = (text_width(" ", size) if space and cur else 0.0) + w
        if cur and cur_w + add > max_w:
            lines.append(cur)
            cur, cur_w = text, w
        else:
            cur += (" " if space and cur else "") + text
            cur_w += add
    if cur:
        lines.append(cur)
    if len(lines) > max_lines:
        raise ValueError(f"{s!r} needs {len(lines)} lines (max {max_lines}) in {max_w}px")
    return lines


# ---------------------------------------------------------------------------- SVG


def num(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


class Svg:
    def __init__(self, width, lang, font):
        self.w, self.lang, self.font = width, lang, font
        self.body = []
        self.h = 0

    def add(self, s):
        self.body.append(s)

    def rect(self, x, y, w, h, fill="none", stroke="none", sw=1, rx=0, dash=None, extra=""):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(
            f'<rect x="{num(x)}" y="{num(y)}" width="{num(w)}" height="{num(h)}" rx="{num(rx)}" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="{num(sw)}"{d}{extra}/>'
        )

    def line(self, x1, y1, x2, y2, stroke=TEXT, sw=1.5, dash=None, arrow=False, cap="butt"):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        m = ' marker-end="url(#arrow)"' if arrow else ""
        self.add(
            f'<line x1="{num(x1)}" y1="{num(y1)}" x2="{num(x2)}" y2="{num(y2)}" '
            f'stroke="{stroke}" stroke-width="{num(sw)}" stroke-linecap="{cap}"{d}{m}/>'
        )

    def poly(self, pts, stroke=TEXT, sw=1.5, dash=None, arrow=False, fill="none"):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        m = ' marker-end="url(#arrow)"' if arrow else ""
        p = " ".join(f"{num(x)},{num(y)}" for x, y in pts)
        self.add(
            f'<polyline points="{p}" fill="{fill}" stroke="{stroke}" stroke-width="{num(sw)}" '
            f'stroke-linejoin="round" stroke-linecap="round"{d}{m}/>'
        )

    def circle(self, x, y, r, fill=TEXT, stroke="none", sw=1):
        self.add(
            f'<circle cx="{num(x)}" cy="{num(y)}" r="{num(r)}" fill="{fill}" '
            f'stroke="{stroke}" stroke-width="{num(sw)}"/>'
        )

    def text(self, x, y, s, size=14, anchor="start", weight="normal", fill=TEXT, italic=False):
        st = ' font-style="italic"' if italic else ""
        w = ' font-weight="bold"' if weight == "bold" else ""
        self.add(
            f'<text x="{num(x)}" y="{num(y)}" font-size="{num(size)}" text-anchor="{anchor}" '
            f'fill="{fill}"{w}{st}>{escape(s, quote=False)}</text>'
        )

    def lines(self, x, y, lines, size=14, anchor="start", weight="normal", fill=TEXT, lh=1.3):
        """Draw wrapped lines with the first baseline at y; return the y below the block."""
        for i, s in enumerate(lines):
            self.text(x, y + i * size * lh, s, size, anchor, weight, fill)
        return y + (len(lines) - 1) * size * lh + size * 0.45

    def para(
        self, x, y, s, max_w, size=14, anchor="start", weight="normal", fill=TEXT, max_lines=4
    ):
        return self.lines(x, y, wrap(s, max_w, size, max_lines), size, anchor, weight, fill)

    def render(self, title, desc):
        h = math.ceil(self.h)
        head = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<svg xmlns="http://www.w3.org/2000/svg" xml:lang="{self.lang}" '
            f'width="{self.w}" height="{h}" viewBox="0 0 {self.w} {h}" role="img" '
            f'aria-labelledby="title desc" font-family="{escape(self.font)}">\n'
            f'<title id="title">{escape(title, quote=False)}</title>\n'
            f'<desc id="desc">{escape(desc, quote=False)}</desc>\n'
            "<defs>"
            '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
            'markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">'
            f'<path d="M0,0 L10,5 L0,10 z" fill="{TEXT}"/></marker>'
            "</defs>\n"
            f'<rect x="0.5" y="0.5" width="{self.w - 1}" height="{h - 1}" rx="6" fill="{BG}" '
            f'stroke="{GRID}" stroke-width="1"/>\n'
        )
        return head + "\n".join(self.body) + "\n</svg>\n"


def heading(svg, title, y=30, size=18):
    lines = wrap(title, svg.w - 40, size * BOLD, 3)
    return svg.lines(svg.w / 2, y, lines, size, "middle", "bold") + 14


# ------------------------------------------------------------------------ boxes


class Box:
    """A labelled box: a file (white, outlined) or a command (green pill)."""

    def __init__(
        self, title, sub=None, kind="file", width=146, size=14, sub_size=13, lines=None, stroke=TEXT
    ):
        self.kind, self.w, self.size, self.sub_size, self.stroke = (
            kind,
            width,
            size,
            sub_size,
            stroke,
        )
        pad = 16 if kind == "cmd" else 12
        self.t = wrap(title, width - pad, size * (BOLD if kind == "cmd" else 1.0))
        self.s = wrap(sub, width - pad, sub_size) if sub else []
        self.extra = [wrap(e, width - pad, sub_size) for e in (lines or [])]
        n_sub = len(self.s) + sum(len(e) for e in self.extra)
        self.h = 14 + len(self.t) * size * 1.25 + n_sub * sub_size * 1.3 + (4 if n_sub else 0)
        if kind == "cmd":
            self.h = max(self.h, 38)

    def draw(self, svg, cx, top, h=None):
        h = h or self.h
        x = cx - self.w / 2
        if self.kind == "cmd":
            svg.rect(x, top, self.w, h, fill=GREEN, rx=h / 2 if h < 48 else 12)
            fill, sub_fill = "#ffffff", "#e6f0ea"
        else:
            svg.rect(x, top, self.w, h, fill=FILE_FILL, stroke=self.stroke, sw=1.4, rx=4)
            fill, sub_fill = TEXT, MUTED
        n_sub = len(self.s) + sum(len(e) for e in self.extra)
        content = len(self.t) * self.size * 1.25 + n_sub * self.sub_size * 1.3 + (4 if n_sub else 0)
        y = top + (h - content) / 2 + self.size * 0.95
        weight = "bold" if self.kind == "cmd" else "normal"
        for s in self.t:
            svg.text(cx, y, s, self.size, "middle", weight, fill)
            y += self.size * 1.25
        if n_sub:
            y += 4 - self.size * 0.25 + self.sub_size * 0.3
        for s in self.s:
            svg.text(cx, y, s, self.sub_size, "middle", fill=sub_fill)
            y += self.sub_size * 1.3
        for block in self.extra:
            for s in block:
                svg.text(cx, y, s, self.sub_size, "middle", fill=TEXT)
                y += self.sub_size * 1.3
        self.cx, self.top, self.bottom = cx, top, top + h
        self.left, self.right, self.mid = x, x + self.w, top + h / 2


# ------------------------------------------------------------------ figure: pipeline


def fig_pipeline(L, lang):
    W = 520
    svg = Svg(W, lang, L["font"])
    y = heading(svg, L["pipeline_title"])
    cols = [20 + 73, 260, 520 - 20 - 73]
    gap_y = 30

    def row(boxes):
        nonlocal y
        h = max(b.h for b, _ in boxes)
        for b, c in boxes:
            b.draw(svg, cols[c], y, h)
        y += h + gap_y
        return h

    calib_in = Box(L["calib_in"], L["calib_in_sub"])
    calibrate = Box("calibrate", kind="cmd", width=124)
    calib_out = Box(L["calib_out"], L["calib_out_sub"])
    h1 = max(calib_in.h, calib_out.h)
    calib_in.draw(svg, cols[0], y, h1)
    calib_out.draw(svg, cols[2], y, h1)
    calibrate.draw(svg, cols[1], y + (h1 - calibrate.h) / 2)
    svg.line(calib_in.right, calib_in.mid, calibrate.left, calib_in.mid, arrow=True)
    svg.line(calibrate.right, calib_in.mid, calib_out.left, calib_in.mid, arrow=True)
    y += h1 + gap_y

    tracks = Box(L["tracks"], L["tracks_sub"])
    review = Box(L["review"], L["review_sub"])
    row([(tracks, 0), (review, 1)])

    run_top = y - 12
    analyze = Box("analyze", kind="cmd", width=124)
    analyze.draw(svg, cols[1], y)
    svg.line(review.cx, review.bottom, review.cx, analyze.top, arrow=True)
    svg.poly(
        [(tracks.cx, tracks.bottom), (tracks.cx, analyze.mid), (analyze.left, analyze.mid)],
        arrow=True,
    )
    svg.poly(
        [
            (calib_out.cx, calib_out.bottom),
            (calib_out.cx, analyze.mid),
            (analyze.right, analyze.mid),
        ],
        arrow=True,
    )
    y += analyze.h + gap_y

    video = Box(L["video"], L["video_sub"])
    analysis = Box(L["analysis"])
    row([(video, 0), (analysis, 1)])
    svg.line(analyze.cx, analyze.bottom, analyze.cx, analysis.top, arrow=True)

    render = Box("render", kind="cmd", width=124)
    render.draw(svg, cols[1], y)
    svg.line(analysis.cx, analysis.bottom, analysis.cx, render.top, arrow=True)
    svg.poly(
        [(video.cx, video.bottom), (video.cx, render.mid), (render.left, render.mid)], arrow=True
    )
    run_bottom = render.bottom + 12
    y += render.h + gap_y + 6

    mp4 = Box(L["mp4"])
    report = Box(L["report"])
    hr = max(mp4.h, report.h)
    mp4.draw(svg, cols[0], y, hr)
    report.draw(svg, cols[2], y, hr)
    split = render.bottom + (y - render.bottom) / 2
    svg.line(render.cx, render.bottom, render.cx, split)
    svg.poly([(render.cx, split), (mp4.cx, split), (mp4.cx, mp4.top)], arrow=True)
    svg.poly([(render.cx, split), (report.cx, split), (report.cx, report.top)], arrow=True)

    # "run" covers analyze .. render.
    rx0, rx1 = cols[1] - 86, cols[1] + 86
    svg.rect(
        rx0, run_top, rx1 - rx0, run_bottom - run_top, stroke=ORANGE, sw=1.4, rx=10, dash="5 4"
    )
    svg.rect(rx1 - 40, run_top - 9, 36, 18, fill=BG)
    svg.text(rx1 - 22, run_top + 5, "run", 13, "middle", "bold", ORANGE)
    y += hr + 22

    y = svg.para(W / 2, y, L["run_note"], W - 40, 13, "middle", fill=MUTED, max_lines=3) + 18
    # Legend.
    lw = text_width(L["legend_file"], 13) + text_width(L["legend_cmd"], 13) + 110
    lx = (W - lw) / 2
    svg.rect(lx, y - 11, 28, 16, fill=FILE_FILL, stroke=TEXT, sw=1.2, rx=3)
    svg.text(lx + 36, y + 2, L["legend_file"], 13)
    lx2 = lx + 36 + text_width(L["legend_file"], 13) + 24
    svg.rect(lx2, y - 11, 28, 16, fill=GREEN, rx=8)
    svg.text(lx2 + 36, y + 2, L["legend_cmd"], 13)
    svg.h = y + 18
    return svg.render(L["pipeline_title"], L["pipeline_desc"])


# --------------------------------------------------------------------- figure: court


def fig_court(L, lang):
    W = 520
    svg = Svg(W, lang, L["font"])
    y = heading(svg, L["court_title"])
    y = svg.para(W / 2, y + 2, L["plan_view"], W - 40, 14, "middle", fill=MUTED) + 30

    s = 30.0  # px per metre
    x0 = 96
    y0 = y + 22
    cw, cl = COURT_WIDTH_M * s, COURT_LENGTH_M * s

    def P(x, yy):
        return x0 + x * s, y0 + yy * s

    svg.rect(x0, y0, cw, cl, fill=GREEN)
    for (ax, ay), (bx, by) in court_lines():
        (u0, v0), (u1, v1) = P(ax, ay), P(bx, by)
        svg.line(u0, v0, u1, v1, stroke="#ffffff", sw=0.04 * s)
    nu0, nv = P(-0.25, NET_Y_M)
    nu1, _ = P(COURT_WIDTH_M + 0.25, NET_Y_M)
    svg.line(nu0, nv, nu1, nv, stroke=TEXT, sw=3.5)
    svg.circle(nu0, nv, 3.2)
    svg.circle(nu1, nv, 3.2)

    # Axes from the origin (outer corner of far-left boundary).
    ox, oy = P(0, 0)
    svg.line(ox, oy - 22, ox + cw + 18, oy - 22, arrow=True, sw=1.3)
    svg.text(ox + cw + 22, oy - 18, "X", 14, weight="bold")
    svg.line(ox - 36, oy, ox - 36, oy + cl + 22, arrow=True, sw=1.3)
    svg.text(ox - 36, oy + cl + 38, "Y", 14, "middle", "bold")
    for xv, lab in ((0.0, "0"), (COURT_WIDTH_M / 2, "3.05"), (COURT_WIDTH_M, "6.10")):
        u, _ = P(xv, 0)
        svg.line(u, oy - 26, u, oy - 18, sw=1.3)
        svg.text(u, oy - 31, lab, 13, "middle")
    svg.line(ox - 30, oy, ox - 6, oy, stroke=MUTED, sw=0.8, dash="2 2")
    svg.circle(ox, oy, 3.4, fill=ORANGE)

    # Z points toward the viewer: circled dot.
    zx, zy = ox - 62, oy - 22
    svg.circle(zx, zy, 7, fill=BG, stroke=TEXT, sw=1.3)
    svg.circle(zx, zy, 2.2)
    svg.text(zx, zy - 12, "Z", 14, "middle", "bold")

    short_far = NET_Y_M - 2.0
    short_near = NET_Y_M + 2.0
    ticks = [
        (0.0, "0", L["far_baseline"]),
        (short_far, "4.70", L["short_service"]),
        (NET_Y_M, "6.70", f"{L['net']}, Y = 6.70"),
        (short_near, "8.70", L["short_service"]),
        (COURT_LENGTH_M, "13.40", L["near_baseline"]),
    ]
    label_x = x0 + cw + 14
    label_w = W - label_x - 16
    for yv, lab, name in ticks:
        _, v = P(0, yv)
        svg.line(ox - 40, v, ox - 32, v, sw=1.3)
        svg.text(ox - 44, v + 4.5, lab, 13, "end")
        svg.line(x0 + cw + 2, v, label_x - 2, v, stroke=MUTED, sw=0.8)
        ls = wrap(name, label_w, 13, 2)
        top = v + 4.5 - (len(ls) - 1) * 13 * 1.3 / 2
        weight = "bold" if yv == NET_Y_M else "normal"
        svg.lines(label_x, top, ls, 13, weight=weight)
    _, nvb = P(0, NET_Y_M)
    svg.para(label_x, nvb + 30, L["net_heights"], label_w, 13, fill=MUTED, max_lines=2)
    svg.lines(ox + 6, oy + 16, wrap(L["origin"], cw - 12, 13, 2), 13, fill="#ffffff")
    y = y0 + cl + 54

    # Side view: Y to the right, Z up, same scale.
    y = svg.para(W / 2, y, L["side_view"], W - 40, 14, "middle", fill=MUTED) + 10
    zs = s
    zmax = 2.0
    base = y + zmax * zs + 14
    sx0 = (W - COURT_LENGTH_M * s) / 2 + 10

    def Q(yy, z):
        return sx0 + yy * s, base - z * zs

    a, b = Q(0, 0), Q(COURT_LENGTH_M, 0)
    svg.line(a[0], a[1], b[0], b[1], stroke=GREEN, sw=5)
    svg.line(a[0], a[1] + 14, b[0] + 18, b[1] + 14, arrow=True, sw=1.3)
    svg.text(b[0] + 22, b[1] + 18, "Y", 14, weight="bold")
    za, zb = Q(0, 0), Q(0, zmax)
    svg.line(za[0] - 14, za[1], zb[0] - 14, zb[1] - 10, arrow=True, sw=1.3)
    svg.text(zb[0] - 14, zb[1] - 16, "Z", 14, "middle", "bold")
    n0, n1 = Q(NET_Y_M, 0), Q(NET_Y_M, NET_CENTRE_HEIGHT_M)
    svg.line(n0[0], n0[1], n1[0], n1[1], stroke=TEXT, sw=3.5)
    np_ = Q(NET_Y_M, NET_POST_HEIGHT_M)
    svg.line(np_[0] - 6, np_[1], np_[0] + 6, np_[1], stroke=TEXT, sw=1.3)
    for yv, lab in ((0.0, "0"), (NET_Y_M, "6.70"), (COURT_LENGTH_M, "13.40")):
        u, v = Q(yv, 0)
        svg.line(u, v + 10, u, v + 18, sw=1.3)
        svg.text(u, v + 32, lab, 13, "middle")
    for zv, lab in ((0.0, "0"), (NET_CENTRE_HEIGHT_M, "1.524")):
        u, v = Q(0, zv)
        svg.line(u - 18, v, u - 10, v, sw=1.3)
        svg.text(u - 22, v + 4.5, lab, 13, "end")
    svg.line(
        Q(0, NET_CENTRE_HEIGHT_M)[0] - 8, n1[1], n1[0] - 8, n1[1], stroke=MUTED, sw=0.8, dash="2 3"
    )
    hx = n1[0] + 12
    svg.para(hx, n1[1] - 4, L["net_heights"], W - hx - 16, 13, fill=MUTED, max_lines=2)
    zl = wrap(L["z_up"], W - Q(8.2, 0)[0] - 16, 13, 2)
    svg.lines(Q(8.2, 0)[0], base - 10 - (len(zl) - 1) * 13 * 1.3, zl, 13, fill=MUTED)
    y = base + 52
    y = svg.para(W / 2, y, L["outer_edge_note"], W - 40, 13, "middle", fill=MUTED) + 10
    svg.h = y
    return svg.render(L["court_title"], L["court_desc"])


# ------------------------------------------------------------ figure: render pipeline


def fig_render_pipeline(L, lang):
    W = 520
    svg = Svg(W, lang, L["font"])
    y = heading(svg, L["rp_title"])
    vc, ac = 180, 422  # video and audio column centres
    gap = 26

    src = Box(f"{L['video']} (MP4)", width=240)
    src.draw(svg, (vc + ac) / 2, y)
    y = src.bottom + gap
    demux = Box(L["demux"], kind="cmd", width=240)
    demux.draw(svg, (vc + ac) / 2, y)
    svg.line(src.cx, src.bottom, src.cx, demux.top, arrow=True)
    y = demux.bottom + gap

    vp = Box(L["video_packets"], width=230)
    ap = Box(L["audio_packets"], width=170)
    hp = max(vp.h, ap.h)
    vp.draw(svg, vc, y, hp)
    ap.draw(svg, ac, y, hp)
    svg.poly(
        [
            (demux.cx - 40, demux.bottom),
            (demux.cx - 40, demux.bottom + gap / 2),
            (vc, demux.bottom + gap / 2),
            (vc, vp.top),
        ],
        arrow=True,
    )
    svg.poly(
        [
            (demux.cx + 40, demux.bottom),
            (demux.cx + 40, demux.bottom + gap / 2),
            (ac, demux.bottom + gap / 2),
            (ac, ap.top),
        ],
        arrow=True,
    )
    y += hp + gap

    y += 8
    loop_top = y - 12
    steps = [
        Box(L["decode"], kind="cmd", width=230),
        Box(L["check"], width=230, lines=[L["check_1"], L["check_2"], L["check_3"]], stroke=BLUE),
        Box(L["draw"], kind="cmd", width=230),
        Box(L["encode"], kind="cmd", width=230),
    ]
    prev = vp
    for b in steps:
        b.draw(svg, vc, y)
        svg.line(vc, prev.bottom, vc, b.top, arrow=True)
        prev = b
        y = b.bottom + gap
    loop_bottom = prev.bottom + 10
    svg.rect(
        vc - 128, loop_top, 256, loop_bottom - loop_top, stroke=MUTED, sw=1.1, rx=10, dash="4 4"
    )
    svg.text(vc - 126, loop_top - 5, "k = 0, 1, 2, ...", 13, fill=MUTED)

    copy = Box(L["stream_copy"], kind="cmd", width=170)
    copy_top = steps[1].top
    copy.draw(svg, ac, copy_top)
    svg.line(ac, ap.bottom, ac, copy.top, arrow=True)

    staging = Box(L["staging"], width=330)
    staging.draw(svg, (vc + ac) / 2, y)
    svg.line(vc, prev.bottom, vc, staging.top, arrow=True)
    svg.line(ac, copy.bottom, ac, staging.top, arrow=True)
    y = staging.bottom + gap

    verify = Box(L["verify"], width=300, stroke=BLUE)
    verify.draw(svg, staging.cx, y)
    svg.line(staging.cx, staging.bottom, staging.cx, verify.top, arrow=True)
    y = verify.bottom + gap
    publish = Box(L["publish"], kind="cmd", width=300)
    publish.draw(svg, staging.cx, y)
    svg.line(staging.cx, verify.bottom, staging.cx, publish.top, arrow=True)
    y = publish.bottom + gap
    out = Box(L["mp4"], width=240)
    out.draw(svg, staging.cx, y)
    svg.line(staging.cx, publish.bottom, staging.cx, out.top, arrow=True)
    y = out.bottom + 26

    fail = wrap(L["fail"], W - 64, 13, 3)
    fh = len(fail) * 13 * 1.3 + 14
    svg.rect(20, y - 4, W - 40, fh, fill="#ffffff", stroke=ORANGE, sw=1.2, rx=6, dash="5 4")
    svg.lines(W / 2, y - 4 + 7 + 13 * 0.95, fail, 13, "middle")
    svg.h = y + fh + 14
    return svg.render(L["rp_title"], L["rp_desc"])


# -------------------------------------------------------------- figure: render layout


def layout_numbers(source=EXAMPLE_SOURCE):
    sw, sh = source
    W, H = _even(sw), _even(sh)
    tw = 2 * round(W * 4 / 6 / 2)
    top = TopView(W, tw, H)
    return {
        "source_px": [sw, sh],
        "source_panel_px": [W, H],
        "top_view_panel_px": [tw, H],
        "canvas_px": [W + tw, H],
        "court_scale_px_per_m": top.s,
        "court_origin_px": [top.ox, top.oy],
        "court_size_px": [top.s * COURT_WIDTH_M, top.s * COURT_LENGTH_M],
        "_top": top,
    }


def fig_render_layout(L, lang):
    Wv = 520
    svg = Svg(Wv, lang, L["font"])
    y = heading(svg, L["rl_title"])
    y = svg.para(Wv / 2, y + 2, L["rl_example"], Wv - 40, 20, "middle", fill=MUTED) + 12
    n = layout_numbers()
    top = n.pop("_top")
    W, H = n["source_panel_px"]
    tw = n["top_view_panel_px"][0]
    k = 440 / (W + tw)  # figure px per output px
    x0 = 70
    sw_, tw_, h_ = W * k, tw * k, H * k

    # Panel captions above the canvas.
    cs = wrap(L["source_panel"], sw_ - 8, 20, 3)
    ct = wrap(L["top_panel"], tw_ - 8, 20, 3)
    ch = max(len(cs), len(ct)) * 20 * 1.3
    svg.lines(x0 + sw_ / 2, y + 20, cs, 20, "middle", "bold")
    svg.lines(x0 + sw_ + tw_ / 2, y + 20, ct, 20, "middle", "bold")
    y0 = y + ch + 10

    svg.rect(x0, y0, sw_, h_, fill=PANEL)
    svg.add(
        f'<clipPath id="srcpanel"><rect x="{num(x0)}" y="{num(y0)}" width="{num(sw_)}" '
        f'height="{num(h_)}"/></clipPath><g clip-path="url(#srcpanel)">'
    )
    for i in range(1, 14):  # light hatching: a placeholder, not an image
        xa = x0 + i * sw_ / 12
        svg.line(xa, y0, xa - h_ * 0.35, y0 + h_, stroke="#dde3de", sw=1)
    svg.add("</g>")
    svg.rect(x0, y0, sw_, h_, stroke=TEXT, sw=1.2)
    svg.text(x0 + sw_ / 2, y0 + h_ / 2 + 7, f"{W} × {H}", 22, "middle")

    tx = x0 + sw_
    svg.rect(tx, y0, tw_, h_, fill="#184634", stroke=TEXT, sw=1.2)

    def T(xy):
        u, v = top.px(xy)
        return x0 + u * k, y0 + v * k

    for a, b in court_lines():
        (u0, v0), (u1, v1) = T(a), T(b)
        svg.line(u0, v0, u1, v1, stroke="#e6e6e6", sw=0.7)
    (u0, v0), (u1, v1) = T((-0.2, NET_Y_M)), T((COURT_WIDTH_M + 0.2, NET_Y_M))
    svg.line(u0, v0, u1, v1, stroke="#ffffff", sw=1.8)

    # Width dimensions: 6 : 4.
    dy = y0 + h_ + 16
    for xa, xb, big, px in ((x0, tx, "6", W), (tx, tx + tw_, "4", tw)):
        svg.line(xa, dy - 6, xa, dy + 6, sw=1.1)
        svg.line(xb, dy - 6, xb, dy + 6, sw=1.1)
        svg.line(xa + 2, dy, xb - 2, dy, sw=1.1)
        svg.text((xa + xb) / 2, dy + 22, big, 18, "middle", "bold", ORANGE)
        svg.text((xa + xb) / 2, dy + 44, f"{px} px", 20, "middle", fill=MUTED)
    # Height dimension.
    hx = x0 - 16
    svg.line(hx - 6, y0, hx + 6, y0, sw=1.1)
    svg.line(hx - 6, y0 + h_, hx + 6, y0 + h_, sw=1.1)
    svg.line(hx, y0 + 2, hx, y0 + h_ - 2, sw=1.1)
    svg.text(hx - 6, y0 + h_ / 2 + 4, f"{H}", 16, "end", fill=MUTED)

    y = dy + 66
    rows = [
        L["placeholder"],
        f"{L['tw_label']} = 2 * round(W * 4 / 6 / 2) = {tw} px",
        L["even_note"],
        f"{L['court_fit']}: {num(n['court_scale_px_per_m'])} px/m",
    ]
    for r in rows:
        y = svg.para(Wv / 2, y, r, Wv - 40, 20, "middle", max_lines=5) + 12
    svg.h = y + 4
    return svg.render(L["rl_title"], L["rl_desc"])


# ---------------------------------------------------------------------- physics data


def _flight(k):
    """Integrate one synthetic flight up to its first descending floor crossing."""
    params = START_STATE + [k]
    crossing = physics.floor_crossing(params, gravity=GRAVITY)
    if crossing is None:
        raise RuntimeError("synthetic flight never reaches the floor")
    t_floor, xyz_floor = crossing
    t = np.linspace(0.0, t_floor, SAMPLES)
    # Full states (position and velocity) from the package equations, with the
    # same solver settings simulate() uses, so velocities are integrated states.
    sol = solve_ivp(
        physics._rhs(k, GRAVITY),
        [0, max(t_floor, 1e-7)],
        START_STATE,
        rtol=1e-7,
        atol=1e-8,
        dense_output=True,
        max_step=0.02,
    )
    if not sol.success:
        raise RuntimeError(sol.message)
    states = sol.sol(t).T
    pos_sim = physics.simulate(params, t, gravity=GRAVITY)
    gates = physics.physical_gates(pos_sim, crosses_net=True)
    return params, t_floor, np.asarray(xyz_floor), t, states, pos_sim, gates


def physics_example():
    x0, y0 = START_STATE[0], START_STATE[1]
    vh = math.hypot(START_STATE[3], START_STATE[4])
    uy = START_STATE[4] / vh  # horizontal direction stays fixed: drag is along v
    flights = {}
    for name, k in (("drag", K_DRAG), ("no_drag", K_IDEAL)):
        params, t_floor, xyz_floor, t, st, pos_sim, gates = _flight(k)
        r = lambda a: [round(float(v), DIGITS) + 0.0 for v in a]  # noqa: E731
        dist = np.hypot(st[:, 0] - x0, st[:, 1] - y0)
        speed = np.linalg.norm(st[:, 3:], axis=1)
        entry = {
            "parameters": {
                "x_m": params[0],
                "y_m": params[1],
                "z_m": params[2],
                "vx_m_s": params[3],
                "vy_m_s": params[4],
                "vz_m_s": params[5],
                "k_per_m": params[6],
            },
            "first_floor_crossing": {
                "t_s": round(t_floor, DIGITS),
                "xyz_m": r(xyz_floor),
                "horizontal_distance_m": round(
                    float(np.hypot(xyz_floor[0] - x0, xyz_floor[1] - y0)), DIGITS
                ),
                "source": "shuttle_replay.physics.floor_crossing",
            },
            "net_crossing_height_m": round(physics.net_crossing_height(pos_sim), DIGITS),
            "physical_gates_on_samples": {
                key: (round(v, DIGITS) if isinstance(v, float) else v) for key, v in gates.items()
            },
            "max_peak_height_m": round(float(st[:, 2].max()), DIGITS),
            "check_max_abs_position_difference_vs_simulate_m": float(
                f"{np.abs(st[:, :3] - pos_sim).max():.3e}"
            ),
            "series": {
                "t_s": r(t),
                "x_m": r(st[:, 0]),
                "y_m": r(st[:, 1]),
                "z_m": r(st[:, 2]),
                "horizontal_distance_m": r(dist),
                "vx_m_s": r(st[:, 3]),
                "vy_m_s": r(st[:, 4]),
                "vz_m_s": r(st[:, 5]),
                "speed_m_s": r(speed),
            },
        }
        if k == 0:
            # Closed form for the no-drag case as an independent check.
            tt = np.asarray(t)
            z_exact = START_STATE[2] + START_STATE[5] * tt - 0.5 * GRAVITY * tt**2
            vz_exact = START_STATE[5] - GRAVITY * tt
            sp_exact = np.sqrt(START_STATE[3] ** 2 + START_STATE[4] ** 2 + vz_exact**2)
            entry["check_closed_form_max_abs_error"] = {
                "z_m": float(f"{np.abs(st[:, 2] - z_exact).max():.3e}"),
                "speed_m_s": float(f"{np.abs(speed - sp_exact).max():.3e}"),
            }
        flights[name] = entry
    return {
        "kind": "synthetic_not_measurement",
        "purpose": "Explanatory example for the trajectory-physics page. The initial state "
        "is chosen by hand; no fit was run and nothing here was measured. The no-drag "
        "curve is shown only as a contrast and is not an accepted model output.",
        "model": "dr/dt = v, dv/dt = -k |v| v - g e_z (shuttle_replay.physics._rhs)",
        "gravity_m_s2": GRAVITY,
        "units": {
            "position": "m",
            "time": "s since contact",
            "velocity": "m/s",
            "k": "1/m",
            "speed": "m/s",
        },
        "source_method": {
            "positions": "shuttle_replay.physics.simulate(params, t, gravity)",
            "floor_event": "shuttle_replay.physics.floor_crossing(params, gravity) "
            "(first descending Z = 0 crossing); each series ends there",
            "states_and_speed": "scipy.integrate.solve_ivp on shuttle_replay.physics._rhs(k, g) "
            "with simulate()'s settings (rtol=1e-7, atol=1e-8, max_step=0.02, dense output); "
            "speed is |v| of the integrated velocity state, not a finite difference",
            "gates": "shuttle_replay.physics.physical_gates on the plotted samples "
            "(crosses_net=True); shown for context, this is not a fit acceptance",
            "sampling": f"{SAMPLES} evenly spaced times from 0 to the floor event",
            "rounding": f"series values rounded to {DIGITS} decimals; plotted from these values",
        },
        "terminal_speed_m_s": round(math.sqrt(GRAVITY / K_DRAG), DIGITS),
        "court_reference": {
            "net_y_m": NET_Y_M,
            "net_centre_height_m": NET_CENTRE_HEIGHT_M,
            "net_horizontal_distance_from_start_m": round((NET_Y_M - y0) / uy, DIGITS),
            "far_baseline_y_m": 0.0,
            "far_baseline_horizontal_distance_from_start_m": round((0.0 - y0) / uy, DIGITS),
        },
        "package_sources_sha256": {
            name: hashlib.sha256((ROOT / "src" / "shuttle_replay" / name).read_bytes()).hexdigest()
            for name in ("physics.py", "court.py", "render.py")
        },
        "render_layout_example": {k2: v for k2, v in layout_numbers().items() if k2 != "_top"},
        "flights": flights,
    }


# ---------------------------------------------------------------------------- graphs


def nice_step(span, target=6):
    raw = span / target
    mag = 10 ** math.floor(math.log10(raw))
    for m in (1, 2, 2.5, 5, 10):
        if raw <= m * mag:
            return m * mag
    return 10 * mag


class Plot:
    def __init__(self, svg, x, y, w, h, xmax, ymax):
        self.svg, self.x, self.y, self.w, self.h = svg, x, y, w, h
        self.xs, self.ys = nice_step(xmax), nice_step(ymax, 5)
        self.xmax = math.ceil(xmax / self.xs - 1e-9) * self.xs
        self.ymax = math.ceil(ymax / self.ys - 1e-9) * self.ys

    def P(self, a, b):
        return self.x + a / self.xmax * self.w, self.y + self.h - b / self.ymax * self.h

    def frame(self, xlabel, ylabel):
        s = self.svg
        i = 0
        while i * self.xs <= self.xmax + 1e-9:
            v = i * self.xs
            u, _ = self.P(v, 0)
            s.line(u, self.y, u, self.y + self.h, stroke=GRID, sw=1)
            s.text(u, self.y + self.h + 17, num(v), 13, "middle", fill=MUTED)
            i += 1
        i = 0
        while i * self.ys <= self.ymax + 1e-9:
            v = i * self.ys
            _, w = self.P(0, v)
            s.line(self.x, w, self.x + self.w, w, stroke=GRID, sw=1)
            s.text(self.x - 7, w + 4.5, num(v), 13, "end", fill=MUTED)
            i += 1
        s.line(self.x, self.y + self.h, self.x + self.w, self.y + self.h, sw=1.3)
        s.line(self.x, self.y, self.x, self.y + self.h, sw=1.3)
        s.para(self.x + self.w / 2, self.y + self.h + 38, xlabel, self.w, 13, "middle")
        lines = wrap(ylabel, self.h, 13, 1)
        cx, cy = self.x - 40, self.y + self.h / 2
        s.add(f'<g transform="rotate(-90 {num(cx)} {num(cy)})">')
        s.text(cx, cy, lines[0], 13, "middle")
        s.add("</g>")

    def curve(self, xs, ys, color, dash=None, sw=2.6):
        self.svg.poly(
            [self.P(a, b) for a, b in zip(xs, ys, strict=True)], stroke=color, sw=sw, dash=dash
        )

    def cross(self, a, b, color):
        u, v = self.P(a, b)
        self.svg.line(u - 5, v - 5, u + 5, v + 5, stroke=color, sw=2.2)
        self.svg.line(u - 5, v + 5, u + 5, v - 5, stroke=color, sw=2.2)


def graph_header(svg, L, title):
    y = heading(svg, title)
    badge = L["synthetic_badge"]
    bw = min(text_width(badge, 13) + 24, svg.w - 40)
    lines = wrap(badge, bw - 20, 13, 2)
    bh = len(lines) * 13 * 1.3 + 10
    svg.rect((svg.w - bw) / 2, y - 6, bw, bh, fill="#fff4e8", stroke=ORANGE, sw=1, rx=bh / 2)
    svg.lines(svg.w / 2, y - 6 + 5 + 13 * 0.95, lines, 13, "middle", fill="#8a4a0c")
    return y + bh + 14


def legend(svg, y, items):
    x = 64
    for label, color, dash, sw, sub in items:
        svg.line(x, y - 4, x + 34, y - 4, stroke=color, sw=sw, dash=dash)
        y = svg.para(x + 44, y, label, svg.w - x - 64, 13, max_lines=2)
        if sub:
            y = svg.para(x + 44, y + 12, sub, svg.w - x - 64, 13, fill=color, max_lines=2)
        y += 10
    return y


def _fmt(v, d=2):
    return f"{v:.{d}f}"


def fig_trajectory(L, lang, data):
    W = 520
    svg = Svg(W, lang, L["font"])
    y = graph_header(svg, L, L["traj_title"])
    dr, nd = data["flights"]["drag"], data["flights"]["no_drag"]
    ref = data["court_reference"]
    xmax = max(dr["series"]["horizontal_distance_m"][-1], nd["series"]["horizontal_distance_m"][-1])
    ymax = max(dr["max_peak_height_m"], nd["max_peak_height_m"]) * 1.08
    p = Plot(svg, 70, y + 8, W - 100, 250, xmax, ymax)
    p.frame(L["x_dist"], L["y_height"])

    # Court floor between start and far baseline, then net.
    a, b = p.P(0, 0), p.P(ref["far_baseline_horizontal_distance_from_start_m"], 0)
    svg.line(a[0], a[1], b[0], b[1], stroke=GREEN, sw=6)
    svg.line(b[0], b[1] - 12, b[0], b[1] + 4, stroke=GREEN, sw=2)
    svg.text(b[0] + 4, b[1] - 16, L["baseline_marker"], 13, fill=GREEN)
    n0 = p.P(ref["net_horizontal_distance_from_start_m"], 0)
    n1 = p.P(ref["net_horizontal_distance_from_start_m"], NET_CENTRE_HEIGHT_M)
    svg.line(n0[0], n0[1], n1[0], n1[1], stroke=GREEN, sw=4)
    svg.text(n1[0] - 6, n1[1] + 10, L["net_marker"], 13, "end", fill=GREEN)
    svg.text(n1[0] - 6, n1[1] + 25, f"1.524 {L['unit_m']}", 13, "end", fill=GREEN)

    p.curve(nd["series"]["horizontal_distance_m"], nd["series"]["z_m"], MUTED, dash="7 5")
    p.curve(dr["series"]["horizontal_distance_m"], dr["series"]["z_m"], ORANGE)
    sx, sy = p.P(0, START_STATE[2])
    svg.circle(sx, sy, 4, fill=TEXT)
    subs = []
    for f, color in ((dr, ORANGE), (nd, MUTED)):
        fc = f["first_floor_crossing"]
        p.cross(fc["horizontal_distance_m"], 0, color)
        subs.append(
            f"{L['landing']}: {_fmt(fc['t_s'])} {L['unit_s']}, "
            f"{_fmt(fc['horizontal_distance_m'])} {L['unit_m']}"
        )
    y = p.y + p.h + 70
    y = legend(
        svg,
        y,
        [
            (L["drag_label"], ORANGE, None, 2.6, subs[0]),
            (L["ideal_label"], MUTED, "7 5", 2.6, subs[1]),
        ],
    )
    y = svg.para(W / 2, y + 6, L["graph_note"], W - 40, 13, "middle", fill=MUTED) + 10
    svg.h = y
    desc = L["traj_desc"].format(
        drag_T=_fmt(dr["first_floor_crossing"]["t_s"]),
        drag_d=_fmt(dr["first_floor_crossing"]["horizontal_distance_m"]),
        drag_net=_fmt(dr["net_crossing_height_m"]),
        ideal_T=_fmt(nd["first_floor_crossing"]["t_s"]),
        ideal_d=_fmt(nd["first_floor_crossing"]["horizontal_distance_m"]),
    )
    return svg.render(L["traj_title"], desc)


def fig_speed(L, lang, data):
    W = 520
    svg = Svg(W, lang, L["font"])
    y = graph_header(svg, L, L["speed_title"])
    dr, nd = data["flights"]["drag"], data["flights"]["no_drag"]
    vterm = data["terminal_speed_m_s"]
    xmax = max(dr["series"]["t_s"][-1], nd["series"]["t_s"][-1])
    ymax = max(max(dr["series"]["speed_m_s"]), max(nd["series"]["speed_m_s"])) * 1.08
    p = Plot(svg, 70, y + 8, W - 100, 250, xmax, ymax)
    p.frame(L["x_time"], L["y_speed"])

    a, b = p.P(0, vterm), p.P(p.xmax, vterm)
    svg.line(a[0], a[1], b[0], b[1], stroke=BLUE, sw=1.6, dash="3 4")

    p.curve(nd["series"]["t_s"], nd["series"]["speed_m_s"], MUTED, dash="7 5")
    p.curve(dr["series"]["t_s"], dr["series"]["speed_m_s"], ORANGE)
    v0 = dr["series"]["speed_m_s"][0]
    sx, sy = p.P(0, v0)
    svg.circle(sx, sy, 4, fill=TEXT)
    svg.text(sx + 8, sy - 6, f"{_fmt(v0)} {L['unit_ms']}", 13)
    for f, color, dy in ((dr, ORANGE, 20), (nd, MUTED, -10)):
        t_end, v_end = f["series"]["t_s"][-1], f["series"]["speed_m_s"][-1]
        u, v = p.P(t_end, v_end)
        svg.circle(u, v, 3.6, fill=color)
        svg.text(u - 6, v + dy, f"{_fmt(v_end)} {L['unit_ms']}", 13, "end", fill=color)
    y = p.y + p.h + 70
    terminal = f"{L['terminal']} = {_fmt(vterm)} {L['unit_ms']}"
    y = legend(
        svg,
        y,
        [
            (L["drag_label"], ORANGE, None, 2.6, None),
            (L["ideal_label"], MUTED, "7 5", 2.6, None),
            (terminal, BLUE, "3 4", 1.6, None),
        ],
    )
    y = svg.para(W / 2, y + 6, L["speed_note"], W - 40, 13, "middle", fill=MUTED) + 4
    y = svg.para(W / 2, y + 10, L["graph_note"], W - 40, 13, "middle", fill=MUTED) + 10
    svg.h = y
    desc = L["speed_desc"].format(
        v0=_fmt(v0),
        drag_vT=_fmt(dr["series"]["speed_m_s"][-1]),
        drag_T=_fmt(dr["first_floor_crossing"]["t_s"]),
        vterm=_fmt(vterm),
        ideal_vT=_fmt(nd["series"]["speed_m_s"][-1]),
        ideal_T=_fmt(nd["first_floor_crossing"]["t_s"]),
    )
    return svg.render(L["speed_title"], desc)


# ------------------------------------------------------------------------------ main


def _check_text(name, text):
    if "\u00b7" in text:
        raise ValueError(f"{name}: contains U+00B7")
    for ch in text:
        if unicodedata.category(ch) == "So" or 0x1F000 <= ord(ch) <= 0x1FAFF:
            raise ValueError(f"{name}: contains symbol/emoji {ch!r}")
    for bad in ("/Users/", "/home/", "C:\\", "<script", "href=", "xlink:"):
        if bad in text:
            raise ValueError(f"{name}: contains {bad!r}")


def outputs():
    """Yield (relative path, text) for every generated file."""
    labels = json.loads(LABELS.read_text(encoding="utf-8"))
    missing = [lang for lang in LANGS if lang not in labels]
    if missing:
        raise ValueError(f"figure_labels.json lacks {missing}")
    keys = set(labels["en"])
    for lang in LANGS:
        if set(labels[lang]) != keys:
            raise ValueError(
                f"{lang}: label keys differ from en: {sorted(set(labels[lang]) ^ keys)}"
            )
    data = physics_example()
    yield "physics-example.json", json.dumps(data, indent=1, ensure_ascii=False) + "\n"
    makers = {
        "pipeline": fig_pipeline,
        "court": fig_court,
        "render-pipeline": fig_render_pipeline,
        "render-layout": fig_render_layout,
        "trajectory": lambda L, lang: fig_trajectory(L, lang, data),
        "speed": lambda L, lang: fig_speed(L, lang, data),
    }
    for lang in LANGS:
        for name in FIGURES:
            yield f"{lang}/{name}.svg", makers[name](labels[lang], lang)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--check",
        action="store_true",
        help="regenerate in memory and fail if any file on disk differs",
    )
    a = ap.parse_args(argv)
    bad = 0
    count = 0
    for rel, text in outputs():
        _check_text(rel, text)
        path = OUT / rel
        count += 1
        if a.check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                print(f"differs: {rel}", file=sys.stderr)
                bad += 1
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            path.write_text(text, encoding="utf-8")
    print(f"{'checked' if a.check else 'generated'} {count} files, {bad} differ")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
