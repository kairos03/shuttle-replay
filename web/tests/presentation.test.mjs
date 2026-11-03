// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { frameState, parseAnalysisText } from "../demo/js/analysis-model.js";
import { MIN_LOOP_S, formatClock, loopButtonText, loopLabel, loopWrapTarget, modelAvailable, nextLoop, outsideVideoReadout, plainCopy, primaryReadout, scopeStatement } from "../demo/js/presentation.js";
import { fixture, clone } from "./helpers.mjs";

const realText = readFileSync(new URL("../demo/assets/real/analysis.json", import.meta.url), "utf8");
const real = parseAnalysisText(realText);
const modelled = parseAnalysisText(JSON.stringify(fixture()));

test("real default pair: 2D only, model unavailable, 2D scope statement", () => {
  assert.equal(modelAvailable(real), false);
  assert.match(scopeStatement(false), /2D 관측 후보 확인용/);
  const fr = real.frames[60];
  const r = primaryReadout(real, fr, "ok", null, fr.pts);
  assert.equal(r.now, `프레임 61/${real.frames.length}, ${fr.pts.toFixed(3)}초`);
  assert.equal(r.obs, fr.observed !== null ? "2D 관측 후보 있음" : "2D 관측 후보 없음");
  assert.doesNotMatch(r.obs, /모델/);
});

test("real pair: a null-detector frame says no candidate, not a positive", () => {
  const i = real.frames.findIndex((f) => f.observed === null && f.layer !== "excluded_camera_cut");
  assert.ok(i >= 0);
  const r = primaryReadout(real, real.frames[i], "ok", null, real.frames[i].pts);
  assert.equal(r.kind, "gap");
  assert.equal(r.obs, "2D 관측 후보 없음");
});

test("accepted model pair re-enables the model and drops the 2D-only line", () => {
  assert.equal(modelAvailable(modelled), true);
  assert.doesNotMatch(scopeStatement(true), /2D 관측 후보 확인용|없습니다/);
  const fr = modelled.frames.find((f) => f.modelPx !== null && f.modelFlightId !== null);
  assert.match(primaryReadout(modelled, fr, "ok", null, fr.pts).obs, /조건부 모델 있음/);
});

test("model points only on rejected flights are impossible; no model frames means unavailable", () => {
  const fx = clone(fixture());
  for (const f of fx.frames) { f.shuttle_model_px = null; f.shuttle_model_xyz_m = null; }
  for (const fl of fx.flights) fl.accepted = false;
  let m;
  try { m = parseAnalysisText(JSON.stringify(fx)); } catch { m = null; }
  if (m) assert.equal(modelAvailable(m), false);
  assert.equal(modelAvailable(null), false);
});

test("cut, outside and error states never report a candidate", () => {
  const cut = { index: 0, layer: "excluded_camera_cut", observed: null, modelPx: null, modelFlightId: null };
  assert.equal(primaryReadout(real, cut, "ok", null, 0).kind, "cut");
  assert.match(primaryReadout(real, null, "after", null, 9).obs, /범위 밖/);
  assert.match(outsideVideoReadout(-1).obs, /오프셋/);
  assert.equal(primaryReadout(real, real.frames[0], "ok", "영상 오류 · 디코드", 0).obs, "영상 오류, 디코드");
});

test("visible frame-state labels lose every middle dot", () => {
  const gap = { frames: [{ layer: "x", observed: null, modelPx: null }] };
  const label = plainCopy(frameState(gap, 0).label);
  assert.equal(label.includes("·"), false);
  assert.equal(label, "검출 없음, 모델 없음");
});

test("playback clock text is m:ss.ss and never negative", () => {
  assert.equal(formatClock(0), "0:00.00");
  assert.equal(formatClock(6.973633), "0:06.97");
  assert.equal(formatClock(59.996), "1:00.00");
  assert.equal(formatClock(75.5), "1:15.50");
  assert.equal(formatClock(-1), "0:00.00");
  assert.equal(formatClock(NaN), "0:00.00");
});

test("A-B repeat: one button marks the start, then the end, then clears; the pair stays in time order", () => {
  let loop = nextLoop(null, 1.2);
  assert.deepEqual(loop, { a: 1.2, b: null });
  assert.equal(loopButtonText(loop), "끝 지점 찍기");
  assert.equal(nextLoop(loop, 1.2), loop); // an end on the start itself changes nothing
  assert.equal(nextLoop(loop, 1.2 + MIN_LOOP_S / 2), loop); // nor one closer than MIN_LOOP_S
  assert.deepEqual(nextLoop(loop, 1.2 + MIN_LOOP_S), { a: 1.2, b: 1.2 + MIN_LOOP_S });
  loop = nextLoop(loop, 3.4);
  assert.deepEqual(loop, { a: 1.2, b: 3.4 });
  assert.equal(loopButtonText(loop), "반복 해제");
  assert.deepEqual(nextLoop({ a: 3.4, b: null }, 1.2), { a: 1.2, b: 3.4 }); // end marked before the start
  assert.equal(nextLoop(loop, 2), null);
  assert.equal(loopButtonText(null), "구간 반복");
  assert.equal(loopLabel({ a: 1.2, b: 3.4 }), "구간 반복 중 0:01.20부터 0:03.40까지, 누르면 해제");
  assert.match(loopLabel({ a: 1.2, b: null }), /시작 0:01\.20, 지금 위치를 끝 지점으로 찍기/);
  assert.match(loopLabel(null), /시작 지점으로 찍기/);
});

test("A-B repeat jumps back only once the end mark is reached", () => {
  const loop = { a: 1.2, b: 3.4 };
  assert.equal(loopWrapTarget(loop, 3.3999), null);
  assert.equal(loopWrapTarget(loop, 3.4), 1.2);
  assert.equal(loopWrapTarget(loop, 5), 1.2); // playing on past the span returns into it
  assert.equal(loopWrapTarget(loop, 0.5), null); // before the start: play on into the span
  assert.equal(loopWrapTarget({ a: 1.2, b: null }, 9), null); // start only: no repeat yet
  assert.equal(loopWrapTarget(null, 9), null);
});
