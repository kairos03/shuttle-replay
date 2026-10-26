# SPDX-License-Identifier: AGPL-3.0-only
"""Badminton court world frame (BWF Laws of Badminton, metres).

X increases left to right across the court and Y from the far baseline to the
near baseline. The outer boundary of the court (outer edges of the boundary
lines) spans X = 0 .. 6.10 and Y = 0 .. 13.40; Z is vertical with Z=0 on the
court plane and the net plane is Y = 6.70. Lines are 40 mm wide and
``court_lines()`` returns their centres: outer lines at 0.02 / 6.08 and
0.02 / 13.38, singles sidelines 0.48 / 5.62, short service lines 4.70 / 8.70,
doubles long service lines 0.78 / 12.62, centre line X = 3.05. Calibration
points should be entered in this same line-centre convention.
These are rules-of-the-game dimensions, not clip-specific values.
"""

COURT_WIDTH_M = 6.10
COURT_LENGTH_M = 13.40
NET_Y_M = 6.70
NET_POST_HEIGHT_M = 1.55
NET_CENTRE_HEIGHT_M = 1.524
LINE_WIDTH_M = 0.04
_H = LINE_WIDTH_M / 2
SINGLES_CENTRE_M = 0.48
SHORT_SERVICE_CENTRE_FROM_NET_M = 2.00
DOUBLES_LONG_SERVICE_CENTRE_FROM_BACK_M = 0.78


def court_lines():
    """Return court line centre segments as ((x0, y0), (x1, y1)) pairs in metres."""
    x0, x1 = _H, COURT_WIDTH_M - _H
    y0, y1 = _H, COURT_LENGTH_M - _H
    s = SINGLES_CENTRE_M
    short_far = NET_Y_M - SHORT_SERVICE_CENTRE_FROM_NET_M
    short_near = NET_Y_M + SHORT_SERVICE_CENTRE_FROM_NET_M
    lines = [
        ((x0, y0), (x1, y0)),
        ((x0, y1), (x1, y1)),
        ((x0, y0), (x0, y1)),
        ((x1, y0), (x1, y1)),
        ((s, y0), (s, y1)),
        ((COURT_WIDTH_M - s, y0), (COURT_WIDTH_M - s, y1)),
    ]
    for y in (short_far, short_near):
        lines.append(((x0, y), (x1, y)))
    for y in (
        DOUBLES_LONG_SERVICE_CENTRE_FROM_BACK_M,
        COURT_LENGTH_M - DOUBLES_LONG_SERVICE_CENTRE_FROM_BACK_M,
    ):
        lines.append(((x0, y), (x1, y)))
    cx = COURT_WIDTH_M / 2
    lines.append(((cx, y0), (cx, short_far)))
    lines.append(((cx, short_near), (cx, y1)))
    return lines


def inside_court(x, y, margin=0.0):
    return bool(-margin <= x <= COURT_WIDTH_M + margin and -margin <= y <= COURT_LENGTH_M + margin)
