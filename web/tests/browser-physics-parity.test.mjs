// Numerical parity: Pyodide (WASM) run of web/demo/browser/py vs native CPython R5 output.
// Needs a private case dir (meta.json, calib.rgb, native.json) outside the public tree:
//   PHYSICS_PARITY_CASE=/path/to/case node --test web/tests/browser-physics-parity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bootPhysics, runPhysics } from '../demo/browser/physics-worker.mjs';

const CASE = process.env.PHYSICS_PARITY_CASE;
const PY = fileURLToPath(new URL('../demo/browser/py/', import.meta.url));

test('pyodide physics matches native R5 on a real case', { skip: !CASE && 'PHYSICS_PARITY_CASE unset', timeout: 1800e3 }, async () => {
  const meta = JSON.parse(readFileSync(`${CASE}/meta.json`, 'utf8'));
  const native = JSON.parse(readFileSync(`${CASE}/native.json`, 'utf8'));
  const blob = readFileSync(`${CASE}/calib.rgb`);
  const { width: fw, height: fh, frame_ids } = meta.calib;
  const size = fw * fh * 3;
  const calibrationFrames = frame_ids.map((frame_id, k) => ({
    width: fw, height: fh, frame_id, rgb: new Uint8Array(blob.buffer, blob.byteOffset + k * size, size),
  }));
  const t0 = performance.now();
  const py = await bootPhysics({ indexURL: `${PY}runtime/`, readText: async (rel) => readFileSync(`${PY}${rel}`, 'utf8') });
  const boot = (performance.now() - t0) / 1000;
  const doc = runPhysics(py, { ...meta, calibrationFrames });
  const total = (performance.now() - t0) / 1000;
  writeFileSync(`${CASE}/pyodide.json`, JSON.stringify(doc));
  const rep = compare(native, doc);
  rep.boot_s = boot; rep.total_s = total;
  writeFileSync(`${CASE}/parity.json`, JSON.stringify(rep, null, 2));
  console.log(JSON.stringify(rep, null, 2));
  assert.equal(doc.schema, 'shuttle-replay/analysis/v1');
  assert.equal(doc.player_calibration.status, native.player_calibration.status);
  assert.ok(rep.homography_corner_px_max < 1.0, `court corners differ ${rep.homography_corner_px_max}px`);
  assert.equal(doc.shuttle_map_reference.status, native.shuttle_map_reference.status);
  assert.deepEqual(rep.null_observed_mismatch, 0);
});

export function compare(a, b) {
  const H = (d) => d.player_calibration.image_to_court_h;
  const out = {};
  if (H(a) && H(b)) {
    out.homography_corner_px_max = Math.max(...a.player_calibration.anchors.map((an, k) =>
      Math.hypot(an.image_px[0] - b.player_calibration.anchors[k].image_px[0], an.image_px[1] - b.player_calibration.anchors[k].image_px[1])));
    out.calib_score = [a.player_calibration.score, b.player_calibration.score];
  }
  let refStatusMis = 0, nullMis = 0, refBoth = 0, refOnlyA = 0, refOnlyB = 0, xyz = [], players = 0, playerMis = 0, pxy = [];
  a.frames.forEach((fa, i) => {
    const fb = b.frames[i];
    if ((fa.shuttle_observed_px === null) !== (fb.shuttle_observed_px === null)) nullMis++;
    const ra = fa.shuttle_map_reference, rb = fb.shuttle_map_reference;
    if (ra && rb) {
      refBoth++;
      if (ra.status !== rb.status) refStatusMis++;
      if (ra.xyz_m && rb.xyz_m) xyz.push(Math.hypot(...ra.xyz_m.map((v, j) => v - rb.xyz_m[j])));
    } else if (ra) refOnlyA++; else if (rb) refOnlyB++;
    players += fa.players.length;
    if (fa.players.length !== fb.players.length) playerMis++;
    fa.players.forEach((p, j) => { const q = fb.players[j]; if (q && p.court_xy_m && q.court_xy_m) pxy.push(Math.hypot(p.court_xy_m[0] - q.court_xy_m[0], p.court_xy_m[1] - q.court_xy_m[1])); });
  });
  const stat = (v) => v.length ? { n: v.length, median: v.sort((x, y) => x - y)[v.length >> 1], max: v[v.length - 1] } : { n: 0 };
  const top = (d) => d.shuttle_map_reference;
  Object.assign(out, {
    null_observed_mismatch: nullMis, ref_frames_both: refBoth, ref_only_native: refOnlyA, ref_only_pyodide: refOnlyB, ref_status_mismatch: refStatusMis,
    ref_xyz_diff_m: stat(xyz), player_count_frame_mismatch: playerMis, players_total: players, player_xy_diff_m: stat(pxy),
    reference_status: [top(a).status, top(b).status],
    flights: [top(a).flights?.length, top(b).flights?.length],
    nodes: [top(a).nodes?.length, top(b).nodes?.length],
    native_elapsed_s: a.provenance.physics.elapsed_s, pyodide_elapsed_s: b.provenance.physics.elapsed_s,
    versions: { native: a.provenance.physics, pyodide: b.provenance.physics },
  });
  return out;
}
