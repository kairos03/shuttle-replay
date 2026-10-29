// SPDX-License-Identifier: AGPL-3.0-only
// Browser analysis integration: container timestamps, cut segments, bounds and progress
// bands (video.mjs / analyzer-worker.mjs), worker ownership on cancel/replace
// (analyzer.mjs) and the page flow from a picked file to an autoplayed validated result.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  AnalysisError, checkLimits, checkPts, detectCuts, evenIndices, fitWithin, matrixRotation, poseSideForBudget,
  presentationTimes, segmentsFromCuts,
} from "../demo/browser/video.mjs";
import { GPU_REQUIRED_MESSAGE, makeProgress, requireGpu, requireGpuSessions } from "../demo/browser/analyzer-worker.mjs";
import { BrowserAnalyzer } from "../demo/browser/analyzer.mjs";
import { REAL_JSON, boot, pick, waitFor } from "./app-harness.mjs";

test("pts follow presentation order with the edit-list offset (B-frames, as <video> plays)", () => {
  // Real sample layout: elst media_time 2002 at timescale 30000, ctts reorder.
  const samples = [{ cts: 2002 }, { cts: 6006 }, { cts: 4004 }, { cts: 3003 }, { cts: 5005 }];
  const { order, pts } = presentationTimes(samples, 30000, [{ media_time: 2002, segment_duration: 7007 }], 1000);
  assert.deepEqual(order, [0, 3, 2, 4, 1]);
  assert.deepEqual(pts, [0, 0.033367, 0.066733, 0.1001, 0.133467]);
  // A leading empty edit delays playback; it is added, not guessed from frame index.
  const delayed = presentationTimes([{ cts: 0 }, { cts: 1000 }], 1000, [{ media_time: -1, segment_duration: 500 }, { media_time: 0 }], 1000);
  assert.deepEqual(delayed.pts, [0.5, 1.5]);
  assert.throws(() => checkPts([0, 0.1, 0.1]), (e) => e.code === "bad_timestamps");
});

test("cuts split segments; shots under 8 frames are excluded, never merged", () => {
  const a = new Float64Array(512); a[0] = 1;
  const b = new Float64Array(512); b[511] = 1;
  const hists = [...Array(10).fill(a), ...Array(3).fill(b), ...Array(9).fill(a)];
  const cuts = detectCuts(hists);
  assert.deepEqual(cuts, [10, 13]);
  const { segments, excluded } = segmentsFromCuts(hists.length, cuts);
  assert.deepEqual(segments, [[0, 10], [13, 22]]);
  assert.deepEqual(excluded, [10, 11, 12]);
});

test("bounds fail explicitly; sizes preserve aspect; calibration samples span the segment", () => {
  const ok = { bytes: 1e6, width: 1920, height: 1080, durationS: 10, frames: 300 };
  assert.doesNotThrow(() => checkLimits(ok));
  for (const [patch, code] of [[{ durationS: 40 }, "too_long"], [{ frames: 901 }, "too_many_frames"], [{ width: 7680, height: 4320 }, "too_many_pixels"], [{ frames: 5 }, "too_short"]]) {
    assert.throws(() => checkLimits({ ...ok, ...patch }), (e) => e instanceof AnalysisError && e.code === code);
  }
  assert.deepEqual(fitWithin(1080, 1920, 1280), { width: 720, height: 1280 });
  assert.equal(poseSideForBudget(1920, 1080, 10), 1280);
  assert.ok(poseSideForBudget(1920, 1080, 900) < 1280 && poseSideForBudget(1920, 1080, 900) >= 512);
  const idx = evenIndices(13, 113);
  assert.equal(idx.length, 25);
  assert.equal(idx[0], 13);
  assert.equal(idx.at(-1), 112);
  assert.equal(matrixRotation([0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824]), 90);
});

test("progress is one monotonic 0..1 value across model and physics stages", () => {
  const seen = [];
  const p = makeProgress((m) => seen.push(m.value));
  p("decode", 1);
  p("models", { done: 1, total: 2 });
  p("models", 0.1); // a stage restarting its own count never moves the bar back
  p("physics", { fraction: 1 });
  assert.deepEqual(seen, [...seen].sort((x, y) => x - y));
  assert.equal(seen.at(-1), 1);
});

class StubWorker {
  constructor() { this.posted = []; this.terminated = false; }
  postMessage(m) { this.posted.push(m); }
  terminate() { this.terminated = true; }
  emit(data) { if (!this.terminated) this.onmessage({ data: { id: this.posted[0].id, ...data } }); }
}

test("replace terminates the previous worker; its late messages are ignored", async () => {
  const workers = [];
  const a = new BrowserAnalyzer({ createWorker: () => (workers.push(new StubWorker()), workers.at(-1)) });
  const progress = [];
  const first = a.analyze({ name: "a" }, { onProgress: (p) => progress.push(["a", p.value]) });
  const second = a.analyze({ name: "b" }, { onProgress: (p) => progress.push(["b", p.value]) });
  assert.deepEqual(await first, { status: "cancelled" });
  assert.equal(workers[0].terminated, true);
  workers[0].onmessage({ data: { id: workers[0].posted[0].id, type: "done", doc: {} } }); // stale even if delivered
  workers[1].emit({ type: "progress", value: 0.5 });
  workers[1].emit({ type: "done", doc: { ok: 1 }, sourceSha256: "ab" });
  assert.deepEqual(await second, { status: "done", doc: { ok: 1 }, sourceSha256: "ab" });
  assert.deepEqual(progress, [["b", 0.5]]);
  assert.equal(workers[1].terminated, true);
  assert.equal(a.busy, false);
});

test("picked file: common overlay with progress, validated result attaches and autoplays", async () => {
  const env = await boot();
  const e = env.els;
  pick(e["in-video-first"], { name: "rally.mp4" });
  await waitFor(() => env.workers.length === 1);
  const w = env.workers[0];
  assert.equal(w.opts.type, "module");
  assert.match(w.url, /browser\/analyzer-worker\.mjs$/);
  assert.equal(w.posted[0].type, "analyze");
  assert.equal(w.posted[0].file.name, "rally.mp4");
  assert.equal(e.analyzing.hidden, false);
  assert.equal(e.stage.attrs["aria-busy"], "true");
  assert.equal(e["btn-play"].disabled, true);
  w.emit({ type: "progress", band: "models", stage: "shuttle", value: 0.42 });
  assert.equal(e["analyzing-progress"].value, 42);
  assert.equal(e["analyzing-label"].textContent, "셔틀 추적 42%");
  w.emit({ type: "done", doc: JSON.parse(REAL_JSON) });
  await waitFor(() => e["source-state"].text === "자동 분석 결과");
  assert.equal(e.analyzing.hidden, true);
  assert.equal(e["btn-play"].disabled, false);
  assert.equal(e.video.played, 1);
  assert.ok(JSON.parse(e.stage.dataset.analysis).frames > 0);
  assert.deepEqual(env.fetches, []);
});

test("invalid analysis document is rejected honestly; video stays playable", async () => {
  const env = await boot();
  const e = env.els;
  pick(e["in-video-first"], { name: "rally.mp4" });
  await waitFor(() => env.workers.length === 1);
  env.workers[0].emit({ type: "done", doc: { schema: "other" } });
  await waitFor(() => /검증 실패/.test(e["source-state"].text));
  assert.equal(e["source-msg"].class_error, true);
  assert.equal(e["btn-play"].disabled, false);
  assert.equal(e.stage.dataset.analysis, undefined);
  assert.equal(e.video.played, 0);
});

test("cancel and sample during analysis terminate the worker; nothing stale attaches", async () => {
  const env = await boot();
  const e = env.els;
  pick(e["in-video-first"], { name: "a.mp4" });
  await waitFor(() => env.workers.length === 1);
  e["btn-cancel"].click();
  assert.equal(env.workers[0].terminated, true);
  assert.equal(e.analyzing.hidden, true);
  assert.equal(e["btn-play"].disabled, false);
  assert.match(e["source-state"].text, /취소/);
  pick(e["in-video"], { name: "b.mp4" });
  await waitFor(() => env.workers.length === 2);
  e["btn-demo"].click();
  assert.equal(env.workers[1].terminated, true);
  await waitFor(() => e.video.getAttribute("src") === "assets/real/source_clip.mp4");
  env.workers[1].emit({ type: "done", doc: JSON.parse(REAL_JSON) }); // terminated: dropped
  assert.equal(e.analyzing.hidden, true);
  assert.equal(e["source-state"].text, "");
  assert.equal(e.video.played, 0);
});

test("shuttle then pose, and physics boot then fit, each advance the bar; 100% only when done", () => {
  const seen = [];
  const p = makeProgress((m) => seen.push(m.value));
  p("decode", 1, "decode");
  p("models", { stage: "shuttle", fraction: 1 }, "shuttle");
  const afterShuttle = seen.at(-1);
  p("models", { stage: "pose", fraction: 0.16 }, "pose");
  p("models", { stage: "pose", fraction: 0.58 }, "pose");
  assert.ok(seen.at(-2) > afterShuttle && seen.at(-1) > seen.at(-2), "pose frames move the bar after shuttle finished");
  p("models", { stage: "pose", fraction: 1 }, "pose");
  p("calibration", 1, "calibration_frames");
  p("physics", { stage: "physics_runtime", fraction: 1 }, "physics_runtime");
  const booted = seen.at(-1);
  assert.ok(booted < 0.85, `runtime boot alone must not look nearly done (${booted})`);
  p("physics", { stage: "court", fraction: 0 }, "court");
  p("physics", { stage: "trajectory", fraction: 0.3 }, "trajectory");
  assert.ok(seen.at(-1) > booted);
  p("physics", { stage: "export", fraction: 0.95 }, "export");
  assert.ok(seen.at(-1) < 1, "export is not completion");
  p("physics", 1, "done");
  assert.equal(seen.at(-1), 1);
  assert.deepEqual(seen, [...seen].sort((x, y) => x - y));
});

test("CPU/wasm model fallback is refused with an actionable GPU message", () => {
  assert.throws(() => requireGpu({ navigator: {} }), (e) => e.code === "gpu_required" && e.message === GPU_REQUIRED_MESSAGE);
  assert.doesNotThrow(() => requireGpu({ navigator: { gpu: {} } }));
  assert.doesNotThrow(() => requireGpuSessions({ tracknet: "webgpu", pose: "webgpu" }));
  for (const b of [{ tracknet: "wasm", pose: "webgpu" }, { tracknet: "webgpu", pose: "wasm" }, undefined]) {
    assert.throws(() => requireGpuSessions(b), (e) => e.code === "gpu_required" && /그래픽 가속/.test(e.message) && /chrome:\/\/gpu/.test(e.message));
  }
});

test("worker source disposes the inference sessions after the GPU check refuses", () => {
  const src = readFileSync(new URL("../demo/browser/analyzer-worker.mjs", import.meta.url), "utf8");
  const tryAt = src.indexOf("try {", src.indexOf("await createInference("));
  assert.ok(tryAt > 0 && src.indexOf("requireGpuSessions(inference.backends)") > tryAt, "check runs inside the try");
  assert.ok(src.indexOf("await inference.dispose?.()", tryAt) > tryAt, "finally disposes");
});

test("GPU refusal shows the whole message and keeps the picked video playable", async () => {
  const env = await boot();
  const e = env.els;
  pick(e["in-video-first"], { name: "rally.mp4" });
  await waitFor(() => env.workers.length === 1);
  env.workers[0].emit({ type: "failed", error: { code: "gpu_required", message: GPU_REQUIRED_MESSAGE } });
  await waitFor(() => /자동 분석 실패/.test(e["source-state"].text));
  assert.ok(e["source-state"].text.includes(GPU_REQUIRED_MESSAGE));
  assert.equal(e.analyzing.hidden, true);
  assert.equal(e["btn-play"].disabled, false);
  assert.match(e.video.getAttribute("src"), /^blob:/);
  assert.equal(e.stage.dataset.analysis, undefined);
});
