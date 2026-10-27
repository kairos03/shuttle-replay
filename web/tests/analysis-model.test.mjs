// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AnalysisError,
  durationMismatch,
  firstFrameAtOrAfter,
  frameState,
  lookupFrame,
  outOfBoundsCount,
  parseAnalysisText,
  seekTimeForIndex,
  stepIndex,
  toAnalysisTime,
  toVideoTime,
  trailIndices,
  validateAnalysis,
} from "../demo/js/analysis-model.js";
import { clone, fixture, sampleText } from "./helpers.mjs";

const rejects = (mutate, pattern) => {
  const obj = clone(fixture());
  mutate(obj);
  assert.throws(() => validateAnalysis(obj), (e) => e instanceof AnalysisError && pattern.test(e.message));
};

test("parser rejects non-JSON and unknown schema with Korean messages", () => {
  assert.throws(() => parseAnalysisText("{nope"), /JSON 형식이 아닙니다/);
  assert.throws(() => parseAnalysisText(JSON.stringify({ schema: "shuttle-replay/analysis/v2" })), /지원하지 않는 스키마.*v2/);
  assert.throws(() => parseAnalysisText("[]"), /최상위가 객체가 아닙니다/);
});

test("parser rejects empty, non-monotone and non-finite frame timing", () => {
  rejects((o) => (o.frames = []), /frames 가 비어/);
  rejects((o) => (o.frames[3].pts_s = o.frames[2].pts_s), /단조 증가/);
  rejects((o) => (o.frames[3].pts_s = "0.1"), /pts_s/);
  rejects((o) => (o.frames[4].frame_id = 2), /frame_id 가 증가하지/);
  // NaN / Infinity can't come from JSON.parse, but objects built in-page can carry them.
  rejects((o) => (o.frames[1].shuttle_observed_px = [Infinity, 1]), /유한하지 않은/);
});

test("parser rejects malformed point shapes", () => {
  rejects((o) => (o.frames[0].shuttle_observed_px = [1, 2, 3]), /숫자 2개/);
  rejects((o) => (o.frames[0].shuttle_model_xyz_m = [1, 2]), /숫자 3개/);
  rejects((o) => (o.frames[0].shuttle_model_px = { u: 1, v: 2 }), /숫자 2개/);
});

test("parser enforces flight / segment / frame relationships", () => {
  rejects((o) => (o.frames[0].model_flight_id = "ghost"), /존재하지 않는 비행/);
  rejects((o) => (o.frames[10].model_flight_id = "fr"), /채택되지 않은 비행/);
  rejects((o) => (o.flights[0].segment_id = 9), /존재하지 않는 segment/);
  rejects((o) => (o.frames[10].segment_id = 7), /존재하지 않는 segment/);
  rejects((o) => (o.frames[7].pts_s = 0.25) && (o.frames[7].model_flight_id = "fa"), /시간 범위 밖|segment/);
  rejects((o) => (o.flights[1].id = "fa"), /중복/);
  rejects((o) => (o.frames[8].layer = "observed_pixel"), /카메라 컷/);
  rejects((o) => (o.frames[11].shuttle_model_px = [1, 1]), /model_flight_id 없이/);
  rejects((o) => delete o.flights[0].t_end_s, /t_end_s/);
});

test("untrusted ids stay plain strings and cut frames drop any drawable data", () => {
  const obj = clone(fixture());
  obj.flights[2].id = "<img src=x onerror=alert(1)>";
  obj.frames[8].shuttle_observed_px = [320, 100];
  const m = validateAnalysis(obj);
  assert.equal(m.flights[2].id, "<img src=x onerror=alert(1)>");
  assert.equal(m.frames[8].observed, null);
  assert.ok(Object.isFrozen(m.frames[0]));
});

test("lookup respects VFR pts and reports before/after the analysis span", () => {
  const m = validateAnalysis(fixture());
  assert.equal(lookupFrame(m, -0.01).status, "before");
  assert.deepEqual(lookupFrame(m, 0), { index: 0, status: "ok" });
  assert.equal(lookupFrame(m, 0.1000).index, 2); // 0.1001 not reached yet
  assert.equal(lookupFrame(m, 0.1001).index, 3);
  assert.equal(lookupFrame(m, 0.3).index, 8); // inside the cut
  assert.equal(lookupFrame(m, 0.5 + 0.04).index, 13);
  assert.equal(lookupFrame(m, 0.6).status, "after");
  assert.equal(lookupFrame(m, NaN).index, -1);
});

test("stepping walks analysis frames and seek targets land inside each frame", () => {
  const m = validateAnalysis(fixture());
  assert.equal(stepIndex(m, 0, -1), 0);
  assert.equal(stepIndex(m, 13, 1), 13);
  assert.equal(stepIndex(m, -1, 1), 0);
  for (let i = 0; i < m.frames.length; i++) {
    const t = seekTimeForIndex(m, i);
    assert.equal(lookupFrame(m, t).index, i, `frame ${i}`);
  }
  // Stepping across a long cut gap still visits the next real frame, not a fixed-fps guess.
  assert.equal(lookupFrame(m, seekTimeForIndex(m, stepIndex(m, 8, 1))).index, 9);
});

test("flight t0 jumps to the first frame at or after the reviewed contact", () => {
  const obj = clone(fixture());
  obj.flights[1].t0_s = 0.09; // contact between frames 2 (0.0667) and 3 (0.1001)
  obj.flights[0].t_end_s = 0.09;
  const m = validateAnalysis(obj);
  assert.equal(firstFrameAtOrAfter(m, 0.09), 3);
  assert.equal(firstFrameAtOrAfter(m, 0.1001), 3);
  assert.equal(firstFrameAtOrAfter(m, 9), -1);
  assert.equal(m.flights[m.flightOfFrame[3]].id, "fb");
});

test("offset converts between video and analysis clocks", () => {
  assert.equal(toAnalysisTime(1.0, 0.5), 1.5);
  assert.equal(toVideoTime(1.5, 0.5), 1.0);
  const m = validateAnalysis(fixture());
  assert.match(durationMismatch(m, 0.3, 0), /짧습니다/);
  assert.equal(durationMismatch(m, 0.53, 0), null);
  assert.match(durationMismatch(m, 0.53, 0.2), /앞섭니다|짧습니다/);
});

test("trails never cross gaps, cuts, segments or flight boundaries", () => {
  const m = validateAnalysis(fixture());
  assert.deepEqual(trailIndices(m, 1, "observed"), [0, 1]);
  assert.deepEqual(trailIndices(m, 2, "observed"), []); // gap frame
  assert.deepEqual(trailIndices(m, 3, "observed"), [3]); // after gap + new flight
  assert.deepEqual(trailIndices(m, 7, "observed"), [3, 4, 5, 6, 7]);
  assert.deepEqual(trailIndices(m, 2, "model"), [0, 1, 2]);
  assert.deepEqual(trailIndices(m, 3, "model"), [3]); // fa -> fb boundary
  assert.deepEqual(trailIndices(m, 8, "observed"), []); // cut
  assert.deepEqual(trailIndices(m, 10, "observed"), [10]); // first frame after cut
  assert.deepEqual(trailIndices(m, 13, "observed"), [13]); // after null detection
  assert.deepEqual(trailIndices(m, 11, "model"), []); // rejected flight: no model
  assert.deepEqual(trailIndices(m, 7, "observed", 2), [6, 7]);
});

test("flight context includes rejected flights; cut frames belong to none", () => {
  const m = validateAnalysis(fixture());
  const id = (i) => (m.flightOfFrame[i] >= 0 ? m.flights[m.flightOfFrame[i]].id : null);
  assert.equal(id(2), "fa");
  assert.equal(id(3), "fb");
  assert.equal(id(8), null);
  assert.equal(id(11), "fr");
});

test("frame state describes cuts, gaps and outside-of-span honestly", () => {
  const m = validateAnalysis(fixture());
  assert.equal(frameState(m, 8).kind, "cut");
  assert.equal(frameState(m, 2).kind, "gap");
  assert.equal(frameState(m, 12).kind, "gap");
  assert.equal(frameState(m, 10).kind, "observed");
  assert.equal(frameState(m, 0).kind, "both");
  assert.equal(frameState(m, -1, "after").kind, "outside");
});

test("image bounds come from the video, not from assumptions", () => {
  const m = validateAnalysis(fixture());
  assert.equal(outOfBoundsCount(m, 640, 360), 0);
  // x > 15: observed 16, 17; model 16, 17; all three segment-1 observations.
  assert.equal(outOfBoundsCount(m, 15, 360), 2 + 2 + 3);
});

test("committed synthetic sample parses and matches the pipeline's structure", () => {
  const m = parseAnalysisText(sampleText());
  assert.equal(m.synthetic, true);
  assert.equal(m.frames.length, 180);
  const cut = m.frames.filter((f) => f.layer === "excluded_camera_cut");
  assert.equal(cut.length, 15);
  assert.ok(cut.every((f) => trailIndices(m, f.index, "observed").length === 0));
  // VFR: frame durations are not all equal.
  const d = new Set();
  for (let i = 1; i < 75; i++) d.add(Math.round((m.pts[i] - m.pts[i - 1]) * 1e6));
  assert.ok(d.size >= 2);
  // The first frame after the cut never links back to segment 0.
  assert.deepEqual(trailIndices(m, 90, "model").every((i) => i >= 90), true);
  assert.equal(outOfBoundsCount(m, 640, 360), 0);
  assert.ok(!/\/Users\/|\/home\/|[A-Z]:\\\\/.test(sampleText()));
});
