// SPDX-License-Identifier: AGPL-3.0-only
// Display-only shuttle map reference (conditional estimate). All reference values below are
// SYNTHETIC test input, not inference output.
import assert from "node:assert/strict";
import { test } from "node:test";

import { AnalysisError, LIMITS, validateAnalysis } from "../demo/js/analysis-model.js";
import { modelAvailable } from "../demo/js/presentation.js";
import { playersMapAvailable } from "../demo/js/players.js";
import {
  SHUTTLE_MAP_COLOR,
  shuttleCaption,
  shuttleEdgeArrow,
  shuttleLabelBox,
  shuttleRefLabel,
  shuttleRefTrail,
} from "../demo/js/shuttle-map.js";
import { clone, fixture } from "./helpers.mjs";

const TOP = {
  status: "conditional_reference",
  method: "camera+height prior (synthetic test)",
  note: "조건부 추정",
  assumptions: ["카메라 높이 가정", "셔틀 높이 사전값"],
  coordinate_system: { origin: "far-left corner", y_axis: "far→near" },
  evidence: { ignored: true },
};
const ref = (x, y, status = "estimated", extra = {}) => ({
  xy_m: [x, y], xyz_m: [x, y, 2.1], status, reference_frame_id: null, reference_pts_s: null, flight_id: "fa", ...extra,
});

/** Segment 0: 0 est, 1 est, 2 interp, 3 est(fb), 4 reference -> 3; cut 8 carries a raw ref. */
function withRefs() {
  const d = clone(fixture());
  d.shuttle_map_reference = clone(TOP);
  const f = d.frames;
  f[0].shuttle_map_reference = ref(1, 2);
  f[1].shuttle_map_reference = ref(1.1, 2.2);
  f[2].shuttle_map_reference = ref(1.2, 2.4, "interpolated");
  f[3].shuttle_map_reference = ref(1.3, 2.6, "estimated", { flight_id: "fb" });
  f[4].shuttle_map_reference = ref(1.3, 2.6, "reference", { flight_id: "fb", reference_frame_id: 3, reference_pts_s: 0.1001 });
  f[8].shuttle_map_reference = ref(9, 9);
  f[10].shuttle_map_reference = ref(2, 10, "estimated", { flight_id: null });
  f[11].shuttle_map_reference = ref(2.1, 10.2, "estimated", { flight_id: null });
  return d;
}
const rejects = (d, re) => assert.throws(() => validateAnalysis(d), (e) => e instanceof AnalysisError && (!re || re.test(e.message)));

test("backward compatible: no shuttle_map_reference => unavailable, every frame ref null", () => {
  const m = validateAnalysis(fixture());
  assert.equal(m.hasShuttleMapRef, false);
  assert.equal(m.shuttleMapReference.status, "unavailable");
  assert.deepEqual(m.shuttleMapReference.assumptions, []);
  assert.ok(m.frames.every((fr) => fr.shuttleMapRef === null));
});

test("valid refs normalize to frozen camelCase; strict model fields stay untouched", () => {
  const d = withRefs();
  for (const fr of d.frames) fr.model_flight_id = fr.shuttle_model_px = fr.shuttle_model_xyz_m = null;
  for (const fr of d.frames) if (fr.layer === "conditional_model") fr.layer = "none";
  const m = validateAnalysis(d);
  assert.equal(m.hasShuttleMapRef, true);
  assert.equal(m.shuttleMapReference.status, "conditional_reference");
  assert.deepEqual([...m.shuttleMapReference.assumptions], TOP.assumptions);
  assert.ok(Object.isFrozen(m.shuttleMapReference) && Object.isFrozen(m.shuttleMapReference.assumptions));
  const r4 = m.frames[4].shuttleMapRef;
  assert.deepEqual({ ...r4, xy: [...r4.xy], xyz: [...r4.xyz] }, {
    xy: [1.3, 2.6], xyz: [1.3, 2.6, 2.1], status: "reference", referenceFrameId: 3, referencePts: 0.1001, flightId: "fb",
  });
  assert.ok(Object.isFrozen(r4));
  // Model toggle availability is unchanged by a map reference.
  assert.equal(modelAvailable(m), false);
  assert.ok(m.frames.every((fr) => fr.modelXyz === null && fr.modelPx === null));
  assert.equal(playersMapAvailable(m), false);
});

test("camera-cut frames never carry a map reference; top unavailable strips all refs", () => {
  const m = validateAnalysis(withRefs());
  assert.equal(m.frames[8].shuttleMapRef, null);
  assert.notEqual(m.frames[0].shuttleMapRef, null);
  const d = withRefs();
  d.shuttle_map_reference.status = "unavailable";
  const u = validateAnalysis(d);
  assert.equal(u.hasShuttleMapRef, false);
  assert.ok(u.frames.every((fr) => fr.shuttleMapRef === null));
});

test("malformed refs are rejected with AnalysisError and never reflect input text", () => {
  const bad = (mut, re) => {
    const d = withRefs();
    mut(d);
    rejects(d, re);
  };
  bad((d) => (d.shuttle_map_reference.status = "<img src=x onerror=1>"), /shuttle_map_reference/);
  try {
    const d = withRefs();
    d.frames[0].shuttle_map_reference.status = "<img src=x>";
    validateAnalysis(d);
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof AnalysisError);
    assert.ok(!e.message.includes("<img"));
  }
  bad((d) => (d.shuttle_map_reference = []));
  bad((d) => (d.shuttle_map_reference.assumptions = [1]));
  bad((d) => (d.shuttle_map_reference.assumptions = Array.from({ length: 65 }, () => "a")));
  bad((d) => (d.shuttle_map_reference.method = 5));
  bad((d) => (d.frames[0].shuttle_map_reference.xy_m = [1, Infinity]));
  bad((d) => (d.frames[0].shuttle_map_reference.xy_m = [1]));
  bad((d) => (d.frames[0].shuttle_map_reference.xy_m = null));
  bad((d) => (d.frames[0].shuttle_map_reference.xy_m = [LIMITS.maxAbsCourtM + 1, 2]));
  bad((d) => (d.frames[0].shuttle_map_reference.xyz_m = [1.5, 2, 2.1]), /xy_m/);
  bad((d) => (d.frames[0].shuttle_map_reference = "x"));
  bad((d) => (d.frames[0].shuttle_map_reference.flight_id = ""));
  bad((d) => (d.frames[0].shuttle_map_reference.flight_id = "fr")); // flight of another segment
});

test("reference holds keep the original seed timestamp, same segment, never self or chained", () => {
  const bad = (mut) => {
    const d = withRefs();
    mut(d.frames[4].shuttle_map_reference, d);
    rejects(d);
  };
  bad((r) => (r.reference_frame_id = null));
  bad((r) => (r.reference_pts_s = null));
  bad((r) => (r.reference_pts_s = 0.1335)); // refreshed to own pts
  bad((r) => (r.reference_frame_id = 4)); // self
  bad((r) => (r.reference_frame_id = 999)); // unknown
  bad((r) => { r.reference_frame_id = 10; r.reference_pts_s = 0.4; }); // other segment
  bad((r) => { r.reference_frame_id = 2; r.reference_pts_s = 0.0667; }); // seed must be estimated
  bad((r) => (r.xy_m = [1.4, 2.6])); // held position differs from seed
  bad((r, d) => { // chain: reference -> reference
    d.frames[5].shuttle_map_reference = ref(1.3, 2.6, "reference", { flight_id: "fb", reference_frame_id: 4, reference_pts_s: 0.1335 });
  });
  // A trailing (later) seed is allowed.
  const d = withRefs();
  d.frames[5].shuttle_map_reference = ref(1.5, 3, "reference", { flight_id: "fb", reference_frame_id: 6, reference_pts_s: 0.2002 });
  d.frames[6].shuttle_map_reference = ref(1.5, 3, "estimated", { flight_id: "fb" });
  assert.equal(validateAnalysis(d).frames[5].shuttleMapRef.referencePts, 0.2002);
});

test("trail: last <=40 estimates, breaks at cut, gap, flight change; suppressed during hold", () => {
  const m = validateAnalysis(withRefs());
  // frame 3 (fb) does not connect back to fa frames.
  assert.deepEqual(shuttleRefTrail(m, 3).map((p) => p.index), [3]);
  // frame 2 interpolated joins fa estimates; interpolated pieces are marked dashed.
  const t2 = shuttleRefTrail(m, 2);
  assert.deepEqual(t2.map((p) => p.index), [0, 1, 2]);
  assert.deepEqual(t2.map((p) => p.dashed), [false, false, true]);
  assert.deepEqual(shuttleRefTrail(m, 4), []); // reference hold
  assert.deepEqual(shuttleRefTrail(m, 8), []); // cut
  assert.deepEqual(shuttleRefTrail(m, 11).map((p) => p.index), [10, 11]); // never crosses the cut
  assert.deepEqual(shuttleRefTrail(m, 12), []); // absent
  const d = clone(fixture());
  d.shuttle_map_reference = clone(TOP);
  d.frames = Array.from({ length: 60 }, (_, i) => ({
    frame_id: i, pts_s: i / 30, segment_id: 0, layer: "none", shuttle_observed_px: null,
    shuttle_map_reference: ref(1, 1 + i * 0.01, "estimated", { flight_id: null }),
  }));
  d.segments[0].end_s = 2;
  d.flights = [];
  const big = validateAnalysis(d);
  const t = shuttleRefTrail(big, 59);
  assert.equal(t.length, 40);
  assert.equal(t[39].index, 59);
});

test("labels are fixed estimate wording with reference age", () => {
  assert.equal(shuttleRefLabel({ status: "estimated" }, 1), "셔틀 ≈");
  assert.equal(shuttleRefLabel({ status: "interpolated" }, 1), "셔틀 ≈ 보간");
  assert.equal(shuttleRefLabel({ status: "reference", referencePts: 0.5 }, 0.75), "셔틀 ≈ 참조 0.25초 전");
  assert.equal(shuttleRefLabel({ status: "reference", referencePts: 1.0 }, 0.75), "셔틀 ≈ 참조 0.25초 후");
  assert.equal(shuttleRefLabel({ status: "estimated" }, 1, true), "셔틀 ≈ 범위 밖");
  assert.equal(SHUTTLE_MAP_COLOR, "#fff16a");
  assert.notEqual(SHUTTLE_MAP_COLOR.toLowerCase(), "#ffd84d");
});

test("caption names player manual reference and conditional shuttle estimate without 3D claims", () => {
  const c = shuttleCaption(false, true, true);
  assert.match(c, /선수 바닥 위치 ≈ 수동 코트 보정/);
  assert.match(c, /셔틀 위치 ≈/);
  assert.match(c, /조건부 추정/);
  assert.match(c, /측정한 3D/);
  assert.doesNotMatch(c, /·/);
  assert.equal(shuttleCaption(false, false, false), "현재는 2D 관측 후보 확인용입니다. 3D 보정과 비행 모델이 없습니다.");
});

test("off-court values get a direction-only edge arrow, not a clamped point", () => {
  const box = { x0: -0.6, y0: -0.9, x1: 6.7, y1: 14.3 };
  assert.equal(shuttleEdgeArrow([3, 6], box), null); // inside: no arrow
  const a = shuttleEdgeArrow([20, 20], box);
  assert.equal(a.x, 6.7);
  assert.ok(a.y > 9 && a.y < 10); // ray from court centre; a clamp would give y=14.3
  assert.notDeepEqual([a.x, a.y], [6.7, 14.3]);
  assert.ok(Math.abs(a.angle - Math.atan2(20 - 6.7, 20 - 3.05)) < 1e-9);
  const b = shuttleEdgeArrow([3.05, -50], box);
  assert.deepEqual([a.x > 0, b.y], [true, -0.9]);
});

test("label box stays fully inside the canvas at every edge", () => {
  const cw = 300;
  const ch = 500;
  for (const [x, y] of [[0, 0], [cw, 0], [0, ch], [cw, ch], [cw / 2, ch / 2], [-20, ch + 20]]) {
    const p = shuttleLabelBox(x, y, 80, 16, 10, cw, ch, 4);
    assert.ok(p.x >= 4 && p.y >= 4 && p.x + 80 <= cw - 4 && p.y + 16 <= ch - 4, `${x},${y}`);
  }
});
