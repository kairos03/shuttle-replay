// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { frameState, parseAnalysisText } from "../demo/js/analysis-model.js";
import { modelAvailable, outsideVideoReadout, plainCopy, primaryReadout, scopeStatement } from "../demo/js/presentation.js";
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
