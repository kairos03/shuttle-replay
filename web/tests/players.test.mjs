// SPDX-License-Identifier: AGPL-3.0-only
// Player boxes + manual court reference. All player data below is SYNTHETIC test input,
// not inference output.
import assert from "node:assert/strict";
import { test } from "node:test";

import { AnalysisError, LIMITS, validateAnalysis } from "../demo/js/analysis-model.js";
import {
  PLAYER_IDS,
  PLAYER_SHORT,
  courtCaption,
  courtMarkerVisible,
  fitLabel,
  playerCounts,
  playerReadout,
  playerTrail,
  playersMapAvailable,
} from "../demo/js/players.js";
import { modelAvailable } from "../demo/js/presentation.js";
import { clone, fixture } from "./helpers.mjs";

const kp = () => Array.from({ length: 17 }, (_, i) => [100 + i, 200 + i, 0.9]);
const player = (id, xy = [1.5, 10], extra = {}) => ({
  id, box_px: [90, 150, 140, 260], anchor_px: [115, 258], court_xy_m: xy,
  keypoints: kp(), score: 0.88, status: "detected", anchor_status: "ankle_midpoint", ...extra,
});
const H = [[0.01, 0, 0], [0, 0.02, 0], [0, 0, 1]];
const calib = (extra = {}) => ({
  status: "manual_reference", image_to_court_h: H,
  anchors: [
    { image_px: [0, 0], court_xy_m: [0, 0], label: "far-left corner" },
    { image_px: [610, 0], court_xy_m: [6.1, 0], label: "far-right corner" },
    { image_px: [0, 670], court_xy_m: [0, 13.4], label: "near-left corner" },
    { image_px: [610, 670], court_xy_m: [6.1, 13.4], label: "near-right corner" },
  ],
  checks: { reprojection_px: 1.2 }, note: "synthetic test calibration", ...extra,
});
/** Synthetic fixture with no flights (2D only) plus four players in segment 0 and segment 1. */
function withPlayers({ calibration = calib() } = {}) {
  const fx = clone(fixture());
  fx.flights = [];
  for (const f of fx.frames) {
    f.shuttle_model_px = f.shuttle_model_xyz_m = null;
    f.model_flight_id = null;
    if (f.layer === "conditional_model") f.layer = "observed_pixel";
    f.players = PLAYER_IDS.map((id, k) => player(id, [1 + k, 2 + f.frame_id * 0.1]));
  }
  if (calibration !== "absent") fx.player_calibration = calibration;
  return fx;
}
const rejects = (obj, re) => assert.throws(() => validateAnalysis(obj), (e) => e instanceof AnalysisError && (!re || re.test(e.message)));

test("backward compatible: no players field and no calibration parse to empty players", () => {
  const fx = clone(fixture());
  for (const f of fx.frames) delete f.players;
  const m = validateAnalysis(fx);
  assert.ok(m.frames.every((f) => Array.isArray(f.players) && f.players.length === 0 && Object.isFrozen(f.players)));
  assert.equal(m.playerCalibration.status, "unavailable");
  assert.equal(m.playerCalibration.permitsProjection, false);
  assert.equal(m.hasPlayers, false);
  assert.equal(playerReadout(m, m.frames[0]), null);
});

test("legacy v1 two-player {label, box} entries parse but are never drawn as the four identities", () => {
  const fx = clone(fixture());
  fx.frames[0].players = [
    { label: "far", score: 0.9, box: [312, 116, 329, 150] },
    { label: "near", score: 0.9, box: [324, 192, 352, 247] },
  ];
  const m = validateAnalysis(fx);
  assert.equal(m.frames[0].players.length, 0);
  assert.equal(m.hasPlayers, false);
  assert.equal(m.legacyPlayerEntries, 2);
  // Mixing legacy and new entries in one frame is malformed.
  fx.frames[0].players.push({ id: "near-left", box_px: [1, 1, 2, 2], anchor_px: null, court_xy_m: null, keypoints: null, score: 0.5 });
  rejects(fx, /형식/);
});

test("valid players parse into frozen camelCase structures with stable short IDs", () => {
  const m = validateAnalysis(withPlayers());
  const fr = m.frames[0];
  assert.equal(fr.players.length, 4);
  assert.deepEqual(fr.players.map((p) => p.short), ["N1", "N2", "F1", "F2"]);
  const p = fr.players[0];
  assert.equal(p.id, "near-left");
  assert.deepEqual([...p.box], [90, 150, 140, 260]);
  assert.deepEqual([...p.anchor], [115, 258]);
  assert.deepEqual([...p.courtXy], [1, 2]);
  assert.equal(p.keypoints.length, 17);
  assert.equal(p.anchorStatus, "ankle_midpoint");
  for (const o of [fr.players, p, p.box, p.anchor, p.courtXy, p.keypoints, p.keypoints[15]]) assert.ok(Object.isFrozen(o));
  assert.equal(m.hasPlayers, true);
  assert.deepEqual(PLAYER_SHORT, { "near-left": "N1", "near-right": "N2", "far-left": "F1", "far-right": "F2" });
});

test("valid nulls are preserved: anchor, court_xy_m, missing keypoints", () => {
  const fx = withPlayers();
  fx.frames[0].players = [player("near-left", null, { anchor_px: null, keypoints: null })];
  const p = validateAnalysis(fx).frames[0].players[0];
  assert.equal(p.anchor, null);
  assert.equal(p.courtXy, null);
  assert.equal(p.keypoints, null);
});

test("malformed players fail: ids, duplicates, cap, box, keypoints, score, non-finite, absurd", () => {
  const bad = [
    [(f) => (f.players = "x"), /players/],
    [(f) => (f.players = [player("umpire")]), /id/],
    [(f) => (f.players = [player("near-left"), player("near-left")]), /중복/],
    [(f) => (f.players = Array.from({ length: LIMITS.maxPlayersPerFrame + 1 }, () => player("near-left"))), /너무 많/],
    [(f) => (f.players = [player("near-left", undefined, { box_px: [10, 10, 5, 20] })]), /box_px/],
    [(f) => (f.players = [player("near-left", undefined, { box_px: [1, 2, 3] })]), /좌표/],
    [(f) => (f.players = [player("near-left", undefined, { keypoints: kp().slice(0, 16) })]), /keypoints/],
    [(f) => (f.players = [player("near-left", undefined, { keypoints: [...kp().slice(0, 16), [1, 2, 7]] })]), /keypoints/],
    [(f) => (f.players = [player("near-left", undefined, { score: 1.5 })]), /score/],
    [(f) => (f.players = [player("near-left", undefined, { score: "0.9" })]), /score/],
    [(f) => (f.players = [player("near-left", [Number.NaN, 1])]), /좌표/],
    [(f) => (f.players = [player("near-left", [5000, 1])]), /court_xy_m/],
    [(f) => (f.players = [player("near-left", undefined, { status: 7 })]), /status/],
    [(f) => (f.players = [null]), /객체/],
  ];
  for (const [mut, re] of bad) {
    const fx = withPlayers();
    mut(fx.frames[1]);
    rejects(fx, re);
  }
});

test("malformed calibration fails; unknown status fails; long strings are bounded", () => {
  for (const c of [
    calib({ status: "guess" }),
    calib({ image_to_court_h: [[1, 0], [0, 1]] }),
    calib({ image_to_court_h: [[1, 0, 0], [0, Infinity, 0], [0, 0, 1]] }),
    calib({ anchors: "x" }),
    calib({ anchors: [{ image_px: [0, 0], court_xy_m: [1e9, 0], label: "a" }] }),
    "manual",
  ]) {
    rejects(withPlayers({ calibration: c }));
  }
  const m = validateAnalysis(withPlayers({ calibration: calib({ note: "가".repeat(5000) }) }));
  assert.ok(m.playerCalibration.note.length <= LIMITS.maxIdLength);
});

test("excluded camera-cut frames never carry drawable players even if supplied", () => {
  const m = validateAnalysis(withPlayers());
  const cut = m.frames.filter((f) => f.layer === "excluded_camera_cut");
  assert.ok(cut.length > 0);
  assert.ok(cut.every((f) => f.players.length === 0));
});

test("projection unavailable: no or unavailable calibration strips court coordinates", () => {
  for (const calibration of ["absent", calib({ status: "unavailable", image_to_court_h: null })]) {
    const m = validateAnalysis(withPlayers({ calibration }));
    assert.equal(m.playerCalibration.permitsProjection, false);
    assert.ok(m.frames.every((f) => f.players.every((p) => p.courtXy === null)));
    assert.equal(playersMapAvailable(m), false);
    // Boxes are still drawable on video.
    assert.equal(m.frames[0].players.length, 4);
  }
  // manual_reference without a matrix cannot project either.
  const m2 = validateAnalysis(withPlayers({ calibration: calib({ image_to_court_h: null }) }));
  assert.equal(m2.playerCalibration.permitsProjection, false);
  assert.ok(m2.frames[0].players.every((p) => p.courtXy === null));
});

test("player map is independent of shuttle model availability", () => {
  const m = validateAnalysis(withPlayers());
  assert.equal(modelAvailable(m), false);
  assert.equal(playersMapAvailable(m), true);
  const cap = courtCaption(false, true);
  assert.match(cap, /선수 바닥 위치 ≈/);
  assert.match(cap, /수동 코트 보정/);
  assert.match(cap, /셔틀 3D/);
  assert.equal(cap.includes("·"), false);
  assert.match(courtCaption(false, false), /2D 관측 후보 확인용/);
  assert.match(courtCaption(true, true), /조건부 모델/);
});

test("trail never bridges null anchors, cuts, segment changes or missing players", () => {
  const fx = withPlayers();
  fx.frames[4].players[0].court_xy_m = null; // null in segment 0
  fx.frames[6].players = fx.frames[6].players.filter((p) => p.id !== "near-left"); // missing
  const m = validateAnalysis(fx);
  assert.deepEqual(playerTrail(m, 3, "near-left", 40), [0, 1, 2, 3]);
  assert.deepEqual(playerTrail(m, 4, "near-left", 40), []);
  assert.deepEqual(playerTrail(m, 5, "near-left", 40), [5]);
  assert.deepEqual(playerTrail(m, 7, "near-left", 40), [7]);
  // Segment 1 starts after a cut: never links back to segment 0.
  assert.deepEqual(playerTrail(m, 11, "near-right", 40), [10, 11]);
  assert.deepEqual(playerTrail(m, 8, "near-right", 40), []);
  assert.deepEqual(playerTrail(m, 3, "far-right", 2), [2, 3]);
});

test("counts, readout and court visibility make no accuracy claim and never clip", () => {
  const fx = withPlayers();
  fx.frames[0].players[3].court_xy_m = null;
  const m = validateAnalysis(fx);
  assert.deepEqual(playerCounts(m.frames[0]), { detected: 4, mapped: 3 });
  assert.equal(playerReadout(m, m.frames[0]), "선수 4명 검출, 바닥 위치 3명");
  assert.equal(playerReadout(m, m.frames[8]), "선수 0명 검출, 바닥 위치 0명");
  assert.doesNotMatch(playerReadout(m, m.frames[0]), /정확|accuracy|%/);
  assert.equal(courtMarkerVisible([3, 6], 0.6, 0.9), true);
  assert.equal(courtMarkerVisible([-0.5, 14.2], 0.6, 0.9), true);
  assert.equal(courtMarkerVisible([-1, 6], 0.6, 0.9), false);
  assert.equal(courtMarkerVisible([3, 20], 0.6, 0.9), false);
});

test("labels fit inside the content rect and canvas", () => {
  const rect = { x: 10, y: 20, w: 300, h: 160 };
  const cw = 320;
  const ch = 200;
  for (const [bx, by] of [[0, 0], [305, 175], [150, 100], [-50, -50], [400, 400]]) {
    const p = fitLabel(bx, by, 24, 14, rect, cw, ch);
    assert.ok(p.x >= rect.x && p.x + 24 <= rect.x + rect.w, `x ${p.x}`);
    assert.ok(p.y >= rect.y && p.y + 14 <= rect.y + rect.h, `y ${p.y}`);
  }
  // Label prefers above the box top when room exists.
  assert.deepEqual(fitLabel(100, 100, 24, 14, rect, cw, ch), { x: 100, y: 86 });
});
