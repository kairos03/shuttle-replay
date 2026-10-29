// SPDX-License-Identifier: AGPL-3.0-only
// Pure TrackNetV3 pre/post-processing shared by the browser runtime and Node tests.
//
// Mirrors src/shuttle_replay/auto/tracknet.py (R5 reference): a per-segment median
// background plus 8 consecutive RGB frames stretched to 512x288, /255 -> 27 channels;
// overlapping windows averaged with weights [1,2,3,4,4,3,2,1] that never cross a camera
// cut; a frame's observation is the strongest (by heat sum) 8-connected component of
// heatmap >= 0.5, mapped back through the same stretch. Frames with no component, and
// segments shorter than 8 frames, stay null.

export const IN_W = 512;
export const IN_H = 288;
export const SEQ_LEN = 8;
export const PLANE = IN_W * IN_H;
export const FRAME_BYTES = PLANE * 3;
export const WINDOW_WEIGHTS = Object.freeze([1, 2, 3, 4, 4, 3, 2, 1]);
export const THRESHOLD = 0.5;
export const BG_MAX_SAMPLES = 150;

// numpy: np.median(frames[::max(1, n // 150)], axis=0).astype(np.uint8)
// Even sample counts average the two middle values, then truncate (floor for uint8).
export function segmentBackground(frames) {
  const n = frames.length;
  if (!n) throw new Error('segmentBackground: empty segment');
  const step = Math.max(1, Math.floor(n / BG_MAX_SAMPLES));
  const samples = [];
  for (let i = 0; i < n; i += step) samples.push(checkFrame(frames[i]));
  const m = samples.length;
  const out = new Uint8Array(FRAME_BYTES);
  const hist = new Uint16Array(256);
  const lo = (m - 1) >> 1;
  const hi = m >> 1;
  for (let p = 0; p < FRAME_BYTES; p++) {
    hist.fill(0);
    for (let k = 0; k < m; k++) hist[samples[k][p]]++;
    let acc = 0;
    let a = -1;
    let b = -1;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (a < 0 && acc > lo) a = v;
      if (acc > hi) {
        b = v;
        break;
      }
    }
    out[p] = (a + b) >> 1;
  }
  return out; // HWC RGB
}

export function checkFrame(frame) {
  if (!(frame instanceof Uint8Array) && !(frame instanceof Uint8ClampedArray)) {
    throw new TypeError('TrackNet frames must be Uint8Array RGB 512x288');
  }
  if (frame.length !== FRAME_BYTES) {
    throw new RangeError(`TrackNet frame has ${frame.length} bytes, expected ${FRAME_BYTES} (512x288 RGB)`);
  }
  return frame;
}

// Write HWC RGB uint8 as 3 CHW float planes (/255) at channel offset `ch`.
function writeCHW(dst, ch, rgb) {
  const base = ch * PLANE;
  const r = base;
  const g = base + PLANE;
  const b = base + 2 * PLANE;
  for (let i = 0, j = 0; i < PLANE; i++, j += 3) {
    dst[r + i] = rgb[j] / 255;
    dst[g + i] = rgb[j + 1] / 255;
    dst[b + i] = rgb[j + 2] / 255;
  }
}

// One window tensor [27, 288, 512]: bg first, then frames s..s+7.
export function buildWindow(bg, frames, start, dst = new Float32Array(27 * PLANE)) {
  writeCHW(dst, 0, bg);
  for (let k = 0; k < SEQ_LEN; k++) writeCHW(dst, 3 + 3 * k, checkFrame(frames[start + k]));
  return dst;
}

// Streaming weighted window average over one segment. Memory is bounded to SEQ_LEN
// accumulated heatmaps: after window s has been added, frame s can receive no more windows.
export class WindowAccumulator {
  constructor(n) {
    this.n = n;
    this.ring = Array.from({ length: SEQ_LEN }, () => new Float32Array(PLANE));
    this.weight = new Float32Array(SEQ_LEN);
    this.next = 0; // next frame index to emit
  }

  // heat: Float32Array [8, 288, 512] for window starting at s. Returns finished frames.
  add(s, heat) {
    if (s !== this.next) throw new Error(`windows must be added in order (got ${s}, expected ${this.next})`);
    for (let k = 0; k < SEQ_LEN; k++) {
      const slot = (s + k) % SEQ_LEN;
      const acc = this.ring[slot];
      const w = WINDOW_WEIGHTS[k];
      const off = k * PLANE;
      for (let i = 0; i < PLANE; i++) acc[i] += heat[off + i] * w;
      this.weight[slot] += w;
    }
    const last = s === this.n - SEQ_LEN;
    return this.#emit(last ? this.n : s + 1);
  }

  #emit(until) {
    const done = [];
    for (; this.next < until; this.next++) {
      const slot = this.next % SEQ_LEN;
      const acc = this.ring[slot];
      const wt = Math.max(this.weight[slot], 1e-6);
      const heat = new Float32Array(PLANE);
      for (let i = 0; i < PLANE; i++) heat[i] = acc[i] / wt;
      done.push({ index: this.next, heat });
      acc.fill(0);
      this.weight[slot] = 0;
    }
    return done;
  }
}

// cv2.connectedComponentsWithStats (8-connectivity) on heat >= THRESHOLD, heat-weighted
// centroid per component, strongest by heat sum, mapped back through the stretch resize.
export function heatmapToPx(heat, srcW, srcH, threshold = THRESHOLD) {
  const labels = new Int32Array(PLANE);
  const stack = new Int32Array(PLANE);
  const comps = [];
  for (let start = 0; start < PLANE; start++) {
    if (labels[start] || heat[start] < threshold) continue;
    const id = comps.length + 1;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    let sw = 0, sx = 0, sy = 0, peak = 0, area = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % IN_W;
      const y = (p - x) / IN_W;
      const w = heat[p];
      sw += w;
      sx += w * x;
      sy += w * y;
      if (w > peak) peak = w;
      area++;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= IN_H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= IN_W) continue;
          const q = yy * IN_W + xx;
          if (!labels[q] && heat[q] >= threshold) {
            labels[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    comps.push({
      xy: [round2(((sx / sw) * srcW) / IN_W), round2(((sy / sw) * srcH) / IN_H)],
      peak,
      area,
      sum: sw,
    });
  }
  comps.sort((a, b) => b.sum - a.sum);
  return { xy: comps.length ? comps[0].xy : null, components: comps };
}

export function round2(v) {
  return Math.round(v * 100) / 100;
}

// Normalise [[a,b), ...] half-open frame ranges; validates bounds and ordering.
export function normalizeSegments(segments, n) {
  const list = segments == null ? [[0, n]] : segments;
  const out = [];
  let prev = 0;
  for (const seg of list) {
    const a = Array.isArray(seg) ? seg[0] : seg?.start;
    const b = Array.isArray(seg) ? seg[1] : seg?.end;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < prev || b <= a || b > n) {
      throw new RangeError(`invalid segment ${JSON.stringify(seg)} for ${n} frames`);
    }
    out.push([a, b]);
    prev = b;
  }
  return out;
}
