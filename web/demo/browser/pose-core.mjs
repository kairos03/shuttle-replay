// SPDX-License-Identifier: AGPL-3.0-only
// Pure YOLO11-pose letterbox + decode helpers shared by the browser runtime and Node tests.
// Geometry follows Ultralytics LetterBox (aspect preserved, centered pad value 114,
// cv2.INTER_LINEAR resize); decode follows Ultralytics NMS + scale_boxes/scale_coords
// (boxes and keypoints clipped to the source frame, as Ultralytics does).

export const INPUT_SIZE = 1280; // static square export; R5 used imgsz 1280
export const NUM_KPT = 17;
export const POSE_CONF = 0.1; // R5 pipeline.POSE_CONF
export const POSE_IOU = 0.7; // Ultralytics predict default
export const MAX_DET = 300;

export function letterboxGeometry(srcW, srcH, size = INPUT_SIZE) {
  const r = Math.min(size / srcW, size / srcH);
  const newW = Math.round(srcW * r);
  const newH = Math.round(srcH * r);
  const dw = (size - newW) / 2;
  const dh = (size - newH) / 2;
  const left = Math.round(dw - 0.1) + 0;
  const top = Math.round(dh - 0.1) + 0;
  return { r, newW, newH, left, top, size };
}

// RGB HWC uint8 (any size) -> letterboxed Float32 NCHW [3,size,size] /255, bilinear with
// half-pixel centers (cv2.INTER_LINEAR for upscales/moderate downscales).
export function letterboxRGB(rgb, srcW, srcH, size = INPUT_SIZE, dst = new Float32Array(3 * size * size)) {
  if (rgb.length !== srcW * srcH * 3) throw new RangeError(`pose frame has ${rgb.length} bytes, expected ${srcW}x${srcH} RGB`);
  const geo = letterboxGeometry(srcW, srcH, size);
  const plane = size * size;
  dst.fill(114 / 255);
  const sx = srcW / geo.newW;
  const sy = srcH / geo.newH;
  for (let y = 0; y < geo.newH; y++) {
    let fy = (y + 0.5) * sy - 0.5;
    if (fy < 0) fy = 0;
    let y0 = Math.floor(fy);
    if (y0 > srcH - 1) y0 = srcH - 1;
    const y1 = Math.min(y0 + 1, srcH - 1);
    const wy = Math.min(1, fy - y0);
    const row = (geo.top + y) * size + geo.left;
    for (let x = 0; x < geo.newW; x++) {
      let fx = (x + 0.5) * sx - 0.5;
      if (fx < 0) fx = 0;
      let x0 = Math.floor(fx);
      if (x0 > srcW - 1) x0 = srcW - 1;
      const x1 = Math.min(x0 + 1, srcW - 1);
      const wx = Math.min(1, fx - x0);
      const a = (y0 * srcW + x0) * 3;
      const b = (y0 * srcW + x1) * 3;
      const c = (y1 * srcW + x0) * 3;
      const d = (y1 * srcW + x1) * 3;
      const o = row + x;
      for (let ch = 0; ch < 3; ch++) {
        const top = rgb[a + ch] + (rgb[b + ch] - rgb[a + ch]) * wx;
        const bot = rgb[c + ch] + (rgb[d + ch] - rgb[c + ch]) * wx;
        dst[ch * plane + o] = Math.round(top + (bot - top) * wy) / 255;
      }
    }
  }
  return { tensor: dst, geo };
}

export function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua > 0 ? inter / ua : 0;
}

export function nms(dets, iouThr, maxDet = MAX_DET) {
  const sorted = [...dets].sort((p, q) => q.score - p.score);
  const keep = [];
  for (const d of sorted) {
    if (keep.length >= maxDet) break;
    if (keep.every((k) => iou(k.box, d.box) <= iouThr)) keep.push(d);
  }
  return keep;
}

// data: Float32Array raw output [1, 56, N]: cx,cy,w,h,score,17*(x,y,conf) in letterbox space.
// Returns pose_raw candidates in *source* pixels of a frame (srcW x srcH), optionally scaled
// to an output frame (outW x outH) when pose ran on a resized copy of the original.
export function decodePose(data, dims, geo, { srcW, srcH, outW = srcW, outH = srcH, conf = POSE_CONF, iouThr = POSE_IOU } = {}) {
  const [b, c, n] = dims;
  if (b !== 1 || c !== 5 + NUM_KPT * 3) throw new Error(`unexpected pose output dims ${dims}`);
  const at = (ch, i) => data[ch * n + i];
  const kx = outW / srcW;
  const ky = outH / srcH;
  const unX = (x) => clamp((x - geo.left) / geo.r, 0, srcW) * kx;
  const unY = (y) => clamp((y - geo.top) / geo.r, 0, srcH) * ky;
  const cand = [];
  for (let i = 0; i < n; i++) {
    const score = at(4, i);
    if (score <= conf) continue;
    const cx = at(0, i), cy = at(1, i), w = at(2, i), h = at(3, i);
    cand.push({ i, score, box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] });
  }
  return nms(cand, iouThr).map(({ i, score, box }) => {
    const keypoints = [];
    for (let k = 0; k < NUM_KPT; k++) {
      keypoints.push([r2(unX(at(5 + k * 3, i))), r2(unY(at(6 + k * 3, i))), r4(at(7 + k * 3, i))]);
    }
    return {
      box_px: [r2(unX(box[0])), r2(unY(box[1])), r2(unX(box[2])), r2(unY(box[3]))],
      score: r4(score),
      keypoints,
    };
  });
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
