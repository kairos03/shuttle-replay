// SPDX-License-Identifier: AGPL-3.0-only
// Frame -> flight context must stay correct for overlapping/tied flights and stay
// bounded for hostile-but-schema-valid files (review finding: F*L^2 validation freeze).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { validateAnalysis } from "../demo/js/analysis-model.js";

const MODEL_URL = new URL("../demo/js/analysis-model.js", import.meta.url).href;

/** Reference semantics (the original brute-force definition). */
function referenceContext(obj) {
  const segEnd = new Map(obj.segments.map((s) => [s.segment_id, s.end_s]));
  const windowEnd = (f) => {
    if (f.t_end_s !== undefined && f.t_end_s !== null) return f.t_end_s;
    let end = segEnd.get(f.segment_id);
    for (const g of obj.flights) {
      if (g !== f && g.segment_id === f.segment_id && g.t0_s > f.t0_s && g.t0_s < end) end = g.t0_s;
    }
    return end;
  };
  return obj.frames.map((fr) => {
    if (fr.segment_id === null) return -1;
    let best = -1;
    obj.flights.forEach((f, i) => {
      if (f.segment_id !== fr.segment_id) return;
      if (fr.pts_s >= f.t0_s && fr.pts_s <= windowEnd(f)) {
        if (best === -1 || f.t0_s > obj.flights[best].t0_s) best = i;
      }
    });
    return best;
  });
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Random valid analysis with ties, overlaps, rejected open windows, cuts and empty segments. */
function randomAnalysis(seed) {
  const r = rng(seed);
  const q = (x) => Math.round(x * 20) / 20; // coarse grid -> many exact ties with frame pts
  const segments = [
    { segment_id: 0, start_s: 0, end_s: 3 },
    { segment_id: 1, start_s: 3.5, end_s: 6 },
    { segment_id: 2, start_s: 6.5, end_s: 7 },
  ];
  const flights = [];
  const n = 1 + Math.floor(r() * 12);
  for (let i = 0; i < n; i++) {
    const seg = segments[Math.floor(r() * 3)];
    const t0 = q(seg.start_s - 0.2 + r() * (seg.end_s - seg.start_s + 0.6));
    const accepted = r() < 0.4;
    const f = { id: `f${i}`, segment_id: seg.segment_id, t0_s: t0, accepted, status: accepted ? "accepted" : "insufficient_observations", end_type: "open_segment_end" };
    if (accepted || r() < 0.3) f.t_end_s = q(t0 + r() * 2);
    flights.push(f);
  }
  const frames = [];
  let id = 0;
  for (let t = 0; t <= 7.0001; t += 0.05) {
    const pts = Math.round(t * 20) / 20;
    const seg = segments.find((s) => pts >= s.start_s && pts <= s.end_s);
    frames.push({
      frame_id: id++, pts_s: pts, segment_id: seg ? seg.segment_id : null,
      layer: seg ? "none" : "excluded_camera_cut", shuttle_observed_px: null, model_flight_id: null,
      shuttle_model_xyz_m: null, shuttle_model_px: null,
    });
  }
  return { schema: "shuttle-replay/analysis/v1", segments, flights, frames };
}

test("flight context matches the reference definition on random overlapping/tied flights", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const obj = randomAnalysis(seed);
    const m = validateAnalysis(obj);
    assert.deepEqual(m.flightOfFrame, referenceContext(obj), `seed ${seed}`);
  }
});

test("equal t0 resolves to the earliest-listed flight; later t0 wins while active", () => {
  const frame = (id, pts) => ({ frame_id: id, pts_s: pts, segment_id: 0, layer: "none" });
  const obj = {
    schema: "shuttle-replay/analysis/v1",
    segments: [{ segment_id: 0, start_s: 0, end_s: 1 }],
    flights: [
      { id: "long", segment_id: 0, t0_s: 0, t_end_s: 1, accepted: true },
      { id: "tieA", segment_id: 0, t0_s: 0.2, accepted: false },
      { id: "tieB", segment_id: 0, t0_s: 0.2, accepted: false },
      { id: "short", segment_id: 0, t0_s: 0.5, t_end_s: 0.6, accepted: true },
    ],
    frames: [frame(0, 0.1), frame(1, 0.2), frame(2, 0.55), frame(3, 0.7), frame(4, 0.9)],
  };
  const ids = validateAnalysis(obj).flightOfFrame.map((i) => obj.flights[i].id);
  // tieA/tieB window ends at next greater t0 (0.5); after 'short' ends, 'long' is the only active one.
  assert.deepEqual(ids, ["long", "tieA", "short", "long", "long"]);
  assert.deepEqual(ids, referenceContext(obj).map((i) => obj.flights[i].id));
});

test("hostile 5000 rejected flights x 10000 frames validates within a hard time bound", () => {
  // Run in a child process so a regression times out instead of hanging the runner.
  const script = `
    const { validateAnalysis } = await import(${JSON.stringify(MODEL_URL)});
    const flights = Array.from({ length: 5000 }, (_, i) => ({ id: "r" + i, segment_id: 0, t0_s: 0, accepted: false, status: "rejected_by_gates_or_fit" }));
    const frames = Array.from({ length: 10000 }, (_, i) => ({ frame_id: i, pts_s: i / 100, segment_id: 0, layer: "none" }));
    const t = performance.now();
    const m = validateAnalysis({ schema: "shuttle-replay/analysis/v1", segments: [{ segment_id: 0, start_s: 0, end_s: 100 }], flights, frames });
    if (m.flightOfFrame[9999] !== 0) throw new Error("wrong context " + m.flightOfFrame[9999]);
    console.log(JSON.stringify({ ms: performance.now() - t }));
  `;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    timeout: 10000,
    encoding: "utf8",
    cwd: fileURLToPath(new URL(".", import.meta.url)),
  });
  assert.equal(res.signal, null, "validation did not finish within 10 s (killed)");
  assert.equal(res.status, 0, res.stderr);
  const { ms } = JSON.parse(res.stdout.trim());
  assert.ok(ms < 2000, `validation took ${ms} ms`);
});
