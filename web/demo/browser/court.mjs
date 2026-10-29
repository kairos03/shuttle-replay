// SPDX-License-Identifier: AGPL-3.0-only
// Independent JS court reference (BWF Laws of Badminton, metres; same convention as
// py/shuttle_replay/court.py): X across 0..6.10, Y far->near baseline 0..13.40, net Y=6.70,
// 40 mm lines given by their centres. Used to render real-pixel court images through a
// known homography and to check the automatic calibration against ground truth.

export const COURT_WIDTH_M = 6.10;
export const COURT_LENGTH_M = 13.40;
export const NET_Y_M = COURT_LENGTH_M / 2;
export const LINE_WIDTH_M = 0.04;
const HW = LINE_WIDTH_M / 2;
export const SINGLES_INSET_M = 0.46 + HW; // singles sideline centre from the outer edge
export const SHORT_SERVICE_FROM_NET_M = 1.98 + HW;
export const LONG_SERVICE_FROM_BACK_M = 0.76 + HW;

// Line-centre segments [[x0, y0], [x1, y1]].
export function courtLines() {
  const x0 = HW, x1 = COURT_WIDTH_M - HW, y0 = HW, y1 = COURT_LENGTH_M - HW;
  const xs0 = SINGLES_INSET_M, xs1 = COURT_WIDTH_M - SINGLES_INSET_M;
  const sf = NET_Y_M - SHORT_SERVICE_FROM_NET_M, sn = NET_Y_M + SHORT_SERVICE_FROM_NET_M;
  const lf = LONG_SERVICE_FROM_BACK_M, ln = COURT_LENGTH_M - LONG_SERVICE_FROM_BACK_M;
  const cx = COURT_WIDTH_M / 2;
  return [
    [[x0, y0], [x1, y0]], [[x0, y1], [x1, y1]], // baselines
    [[x0, y0], [x0, y1]], [[x1, y0], [x1, y1]], // doubles sidelines
    [[xs0, y0], [xs0, y1]], [[xs1, y0], [xs1, y1]], // singles sidelines
    [[x0, sf], [x1, sf]], [[x0, sn], [x1, sn]], // short service lines
    [[x0, lf], [x1, lf]], [[x0, ln], [x1, ln]], // doubles long service lines
    [[cx, y0], [cx, sf]], [[cx, sn], [cx, y1]], // centre lines
  ];
}

export function applyH(h, [x, y]) {
  const w = h[2][0] * x + h[2][1] * y + h[2][2];
  return [(h[0][0] * x + h[0][1] * y + h[0][2]) / w, (h[1][0] * x + h[1][1] * y + h[1][2]) / w];
}

// Homography mapping 4 src points to 4 dst points (DLT, h33 = 1).
export function homographyFrom4(src, dst) {
  const A = [], b = [];
  src.forEach(([x, y], i) => {
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  });
  const p = solve(A, b);
  return [[p[0], p[1], p[2]], [p[3], p[4], p[5]], [p[6], p[7], 1]];
}

export function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

function segDist(x, y, [[x0, y0], [x1, y1]]) {
  const dx = x1 - x0, dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
}

// RGB image of the court seen through courtToImage (3x3), lines LINE_WIDTH_M wide; each
// pixel centre is back-projected to the floor (2x2 supersampled for anti-aliasing).
export function renderCourt(courtToImage, width, height, { floor = [40, 110, 70], line = [235, 235, 235], surround = [70, 60, 55] } = {}) {
  const inv = invert3(courtToImage), lines = courtLines();
  const rgb = new Uint8Array(width * height * 3);
  const off = [0.25, 0.75];
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      let hit = 0, onCourt = 0;
      for (const ox of off) for (const oy of off) {
        const [x, y] = applyH(inv, [u + ox, v + oy]);
        const inside = x >= -0.5 && x <= COURT_WIDTH_M + 0.5 && y >= -0.8 && y <= COURT_LENGTH_M + 0.8;
        if (inside) onCourt++;
        if (lines.some((s) => segDist(x, y, s) <= HW)) hit++;
      }
      const base = onCourt >= 2 ? floor : surround, a = hit / 4, k = 3 * (v * width + u);
      for (let c = 0; c < 3; c++) rgb[k + c] = Math.round(base[c] * (1 - a) + line[c] * a);
    }
  }
  return rgb;
}
