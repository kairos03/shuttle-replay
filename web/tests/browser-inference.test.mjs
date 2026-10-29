// SPDX-License-Identifier: AGPL-3.0-only
// Pure TrackNet / YOLO-pose helpers behind web/demo/browser/inference.mjs, plus the model
// manifest. All tensors below are SYNTHETIC; real ONNX parity runs in a browser harness
// (see MODEL-HANDOFF.json), not here.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";

import { forEachPoseFrame, POSE_FRAMES_STREAM } from "../demo/browser/inference.mjs";
import { INPUT_SIZE, decodePose, letterboxGeometry, letterboxRGB } from "../demo/browser/pose-core.mjs";
import {
  FRAME_BYTES, IN_W, PLANE, SEQ_LEN, WindowAccumulator, buildWindow, heatmapToPx,
  normalizeSegments, segmentBackground,
} from "../demo/browser/tracknet-core.mjs";

const browserUrl = new URL("../demo/browser/", import.meta.url);

test("median background matches numpy median + uint8 truncation", () => {
  const frames = [3, 4, 9, 10].map((v) => new Uint8Array(FRAME_BYTES).fill(v));
  assert.equal(segmentBackground(frames)[0], 6); // (4+9)/2 = 6.5 -> 6
  assert.equal(segmentBackground(frames.slice(0, 3))[7], 4);
  // n // 150 stride: 300 frames -> every 2nd sample
  const many = Array.from({ length: 300 }, (_, i) => new Uint8Array(FRAME_BYTES).fill(i % 2 ? 255 : 0));
  assert.equal(segmentBackground(many)[0], 0);
});

test("window tensor is bg then 8 frames, CHW /255", () => {
  const bg = new Uint8Array(FRAME_BYTES).fill(255);
  const frames = Array.from({ length: 9 }, (_, i) => {
    const f = new Uint8Array(FRAME_BYTES);
    f[0] = i; f[1] = 100; f[2] = 200;
    return f;
  });
  const x = buildWindow(bg, frames, 1);
  assert.equal(x[0], 1);
  assert.equal(x[3 * PLANE], Math.fround(1 / 255)); // frame 1 R
  assert.equal(x[4 * PLANE], Math.fround(100 / 255)); // frame 1 G
  assert.equal(x[(3 + 3 * 7) * PLANE], Math.fround(8 / 255)); // frame 8 R
  assert.throws(() => buildWindow(bg, [new Uint8Array(10)], 0), RangeError);
});

test("streaming accumulator equals the reference weighted average", () => {
  const n = 11;
  const w = [1, 2, 3, 4, 4, 3, 2, 1];
  const acc = new WindowAccumulator(n);
  const got = new Map();
  const ref = new Float64Array(n);
  const wt = new Float64Array(n);
  for (let s = 0; s + SEQ_LEN <= n; s++) {
    const heat = new Float32Array(SEQ_LEN * PLANE);
    for (let k = 0; k < SEQ_LEN; k++) {
      const v = (s * 10 + k) / 100;
      heat[k * PLANE] = v;
      ref[s + k] += v * w[k];
      wt[s + k] += w[k];
    }
    for (const { index, heat: h } of acc.add(s, heat)) got.set(index, h[0]);
  }
  assert.equal(got.size, n);
  for (let i = 0; i < n; i++) assert.ok(Math.abs(got.get(i) - ref[i] / wt[i]) < 1e-6, `frame ${i}`);
});

test("heatmap observation: strongest component by sum, weighted centroid, stretch mapping", () => {
  const heat = new Float32Array(PLANE);
  heat[10 * IN_W + 10] = 0.9; // small, high peak
  for (const [x, y] of [[100, 50], [101, 50], [100, 51], [101, 51]]) heat[y * IN_W + x] = 0.6;
  heat[200 * IN_W + 300] = 0.49; // below threshold
  const r = heatmapToPx(heat, 1080, 1920);
  assert.equal(r.components.length, 2);
  assert.deepEqual(r.xy, [Math.round(((100.5 * 1080) / 512) * 100) / 100, Math.round(((50.5 * 1920) / 288) * 100) / 100]);
  assert.equal(heatmapToPx(new Float32Array(PLANE), 1080, 1920).xy, null);
});

test("segments are half-open, ordered and bounded", () => {
  assert.deepEqual(normalizeSegments(null, 5), [[0, 5]]);
  assert.deepEqual(normalizeSegments([[0, 2], { start: 3, end: 5 }], 5), [[0, 2], [3, 5]]);
  assert.throws(() => normalizeSegments([[2, 4], [3, 5]], 5), RangeError);
  assert.throws(() => normalizeSegments([[0, 6]], 5), RangeError);
});

test("pose letterbox + decode maps back to original pixels (incl. stretched input)", () => {
  assert.equal(INPUT_SIZE, 1280);
  const g1280 = letterboxGeometry(1080, 1920);
  assert.deepEqual([g1280.newW, g1280.newH, g1280.left, g1280.top], [720, 1280, 280, 0]);
  const geo = letterboxGeometry(512, 288, 640);
  assert.deepEqual([geo.newW, geo.newH, geo.left, geo.top], [640, 360, 0, 140]);
  const { tensor } = letterboxRGB(new Uint8Array(512 * 288 * 3).fill(255), 512, 288, 640);
  assert.equal(tensor[0], Math.fround(114 / 255));
  assert.equal(tensor[140 * 640], 1);
  const n = 3;
  const data = new Float32Array(56 * n);
  const set = (ch, i, v) => (data[ch * n + i] = v);
  // det 0: box centre (320, 320) 64x128 in letterbox space; det 1 overlaps (suppressed); det 2 low score
  for (const [i, s, cx] of [[0, 0.9, 320], [1, 0.8, 322], [2, 0.05, 100]]) {
    set(0, i, cx); set(1, i, 320); set(2, i, 64); set(3, i, 128); set(4, i, s);
    for (let k = 0; k < 17; k++) { set(5 + 3 * k, i, cx); set(6 + 3 * k, i, 320); set(7 + 3 * k, i, 0.5); }
  }
  const out = decodePose(data, [1, 56, n], geo, { srcW: 512, srcH: 288, outW: 1920, outH: 1080 });
  assert.equal(out.length, 1);
  const k = 1920 / 640;
  assert.deepEqual(out[0].box_px, [288 * k, ((256 - 140) / 1.25) * 3.75, 352 * k, ((384 - 140) / 1.25) * 3.75].map((v) => Math.round(v * 100) / 100));
  assert.equal(out[0].keypoints.length, 17);
  assert.deepEqual(out[0].keypoints[0], [960, Math.round(((180 / 1.25) * 3.75) * 100) / 100, 0.5]);
});

test("model manifest matches the shipped files and each stays under GitHub's 100 MB limit", () => {
  const manifest = JSON.parse(readFileSync(new URL("models/manifest.json", browserUrl), "utf8"));
  const sha = (u) => createHash("sha256").update(readFileSync(u)).digest("hex");
  for (const m of Object.values(manifest.models)) {
    const u = new URL(`models/${m.file}`, browserUrl);
    assert.equal(statSync(u).size, m.bytes, m.file);
    assert.ok(m.bytes < 95e6, m.file);
    assert.equal(sha(u), m.sha256, m.file);
  }
  for (const [file, hash] of Object.entries(manifest.runtime.files)) {
    const u = new URL(`runtime/${file}`, browserUrl);
    assert.ok(statSync(u).size < 95e6, file);
    assert.equal(sha(u), hash, file);
  }
  assert.ok(readFileSync(new URL("models/LICENSES.md", browserUrl), "utf8").includes("Copyright (c) 2024 qaz812345"));
  assert.ok(readFileSync(new URL("runtime/LICENSE", browserUrl), "utf8").includes("Copyright (c) Microsoft Corporation"));
});

function poseStream(indices, log, { failAt } = {}) {
  return {
    [Symbol.asyncIterator]() {
      let k = 0;
      return {
        async next() {
          if (k === failAt) throw new Error("decode failed");
          if (k >= indices.length) return { done: true, value: undefined };
          log.push(`next${indices[k]}`);
          return { done: false, value: { index: indices[k++], width: 4, height: 2, rgb: new Uint8Array(24) } };
        },
        async return() {
          log.push("return");
          return { done: true, value: undefined };
        },
      };
    },
  };
}

test("streamed poseFrames: ordered, excluded frames consumed, one frame alive, iterator closed", async () => {
  assert.equal(POSE_FRAMES_STREAM, true);
  const frames = Array.from({ length: 6 }, () => new Uint8Array(FRAME_BYTES));
  const segs = [[0, 2], [3, 6]];
  const log = [];
  const seen = [];
  await forEachPoseFrame({ poseFrames: poseStream([0, 1, 2, 3, 4, 5], log), frames, segs }, async (i, pf) => {
    assert.equal(log.at(-1), `next${i}`); // step runs before the next frame is pulled
    seen.push([i, pf.width]);
  });
  assert.deepEqual(seen, [[0, 4], [1, 4], [3, 4], [4, 4], [5, 4]]);
  assert.deepEqual(log, ["next0", "next1", "next2", "next3", "next4", "next5", "return"]);

  for (const [indices, opts, re] of [
    [[0, 2, 1], {}, /index 2, expected 1/],
    [[0, 1, 2], {}, /ended after 3 of 6/],
    [[0, 1, 2, 3, 4, 5, 6], {}, /more than 6/],
    [[0, 1, 2, 3, 4, 5], { failAt: 2 }, /decode failed/],
  ]) {
    const l = [];
    await assert.rejects(forEachPoseFrame({ poseFrames: poseStream(indices, l, opts), frames, segs }, async () => {}), re);
    assert.equal(l.at(-1), "return");
  }

  const ctl = new AbortController();
  const l = [];
  await assert.rejects(
    forEachPoseFrame({ poseFrames: poseStream([0, 1, 2, 3, 4, 5], l), frames, segs, signal: ctl.signal }, async (i) => {
      if (i === 1) ctl.abort();
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(l, ["next0", "next1", "return"]);
});

test("array poseFrames stay supported, null entries fall back to the TrackNet frame", async () => {
  const frames = Array.from({ length: 3 }, () => new Uint8Array(FRAME_BYTES));
  const big = { width: 8, height: 4, rgb: new Uint8Array(96) };
  const seen = [];
  await forEachPoseFrame({ poseFrames: [big, null, big], frames, segs: [[1, 3]] }, async (i, pf) => seen.push([i, pf.width]));
  assert.deepEqual(seen, [[1, 512], [2, 8]]);
});
