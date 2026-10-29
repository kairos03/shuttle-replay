// Real-pixel court calibration check: render a BWF court through a known perspective
// homography (court.mjs, independent JS reference), run the vendored R5 courtcal in Pyodide
// via the physics worker core, and compare the recovered corners with ground truth.
// Also checks that a frame with no court is reported as unavailable (no fabricated H).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bootPhysics, runPhysics } from '../demo/browser/physics-worker.mjs';
import { applyH, homographyFrom4, renderCourt, COURT_WIDTH_M, COURT_LENGTH_M, courtLines } from '../demo/browser/court.mjs';

const PY = fileURLToPath(new URL('../demo/browser/py/', import.meta.url));
let pyP;
const boot = () => (pyP ??= bootPhysics({ indexURL: `${PY}runtime/`, readText: async (rel) => readFileSync(`${PY}${rel}`, 'utf8') }));

const W = 960, H = 540;
// Broadcast-like view: far baseline narrower and higher in the image.
const corners = [[0, 0], [COURT_WIDTH_M, 0], [0, COURT_LENGTH_M], [COURT_WIDTH_M, COURT_LENGTH_M]];
const truth = homographyFrom4(corners, [[372, 128], [588, 128], [214, 486], [746, 486]]);

function input(rgb, n = 12) {
  const pts = Array.from({ length: n }, (_, i) => i / 30);
  return {
    pts, segments: [[0, n]], shuttle_px: Array(n).fill(null), pose_raw: Array.from({ length: n }, () => []),
    width: W, height: H, source_sha256: '0'.repeat(64),
    calibrationFrames: [0, 5, 10].map((frame_id) => ({ width: W, height: H, frame_id, rgb })),
  };
}

test('court.mjs line set matches the Python court.py line centres', () => {
  const ys = new Set(courtLines().flatMap(([[, a], [, b]]) => [a.toFixed(2), b.toFixed(2)]));
  for (const y of ['0.02', '0.78', '4.70', '8.70', '12.62', '13.38']) assert.ok(ys.has(y), y);
});

test('automatic calibration recovers a rendered court within 2 px', { timeout: 300e3 }, async () => {
  const py = await boot();
  const doc = runPhysics(py, input(renderCourt(truth, W, H)));
  const cal = doc.player_calibration;
  assert.equal(cal.status, 'automatic_reference');
  assert.ok(cal.score >= 0.6, `score ${cal.score}`);
  for (const an of cal.anchors) {
    const want = applyH(truth, an.court_xy_m);
    const err = Math.hypot(an.image_px[0] - want[0], an.image_px[1] - want[1]);
    assert.ok(err < 2, `${an.label}: ${err.toFixed(2)} px`);
  }
  assert.equal(doc.shuttle_map_reference.status, 'unavailable'); // no shuttle observations
  assert.ok(doc.frames.every((f) => f.shuttle_observed_px === null && f.layer === 'none'));
});

test('no court lines -> calibration unavailable, nothing fabricated', { timeout: 300e3 }, async () => {
  const py = await boot();
  const blank = new Uint8Array(W * H * 3).fill(90);
  const doc = runPhysics(py, input(blank));
  assert.equal(doc.player_calibration.status, 'unavailable');
  assert.equal(doc.player_calibration.image_to_court_h, undefined);
  assert.equal(doc.shuttle_map_reference.status, 'unavailable');
});

test('invalid input raises physics_input with the Python reason', { timeout: 300e3 }, async () => {
  const py = await boot();
  const bad = input(new Uint8Array(W * H * 3));
  bad.shuttle_px = bad.shuttle_px.slice(1);
  assert.throws(() => runPhysics(py, bad), (e) => e.code === 'physics_input' && /length mismatch/.test(e.message));
  const outside = input(new Uint8Array(W * H * 3));
  outside.calibrationFrames[0].frame_id = 99;
  assert.throws(() => runPhysics(py, outside), (e) => e.code === 'physics_input' && /longest segment/.test(e.message));
});
