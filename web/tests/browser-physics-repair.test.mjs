// Regression (repair-R3): R5 jointfit.local_multistart crashed the whole clip with
// "ValueError: Residuals are not finite in the initial point." when one local start
// (impact node moved along its pixel ray) made the fixed-step quadratic-drag RK4 diverge.
// The captured failing call (private pickle from a real 1280 browser run, kept outside the
// public tree) is replayed in Pyodide with a frozen clock (no wall budget):
//   PHYSICS_REPAIR_PKL=/path/lms-last.pkl node --test web/tests/browser-physics-repair.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bootPhysics } from '../demo/browser/physics-worker.mjs';

const PKL = process.env.PHYSICS_REPAIR_PKL;
const PY = fileURLToPath(new URL('../demo/browser/py/', import.meta.url));
let pyP;
const boot = () => (pyP ??= bootPhysics({ indexURL: `${PY}runtime/`, readText: async (rel) => readFileSync(`${PY}${rel}`, 'utf8') }));

test('local multistart skips non-finite starts instead of crashing (captured case)', { skip: !PKL && 'PHYSICS_REPAIR_PKL unset', timeout: 900e3 }, async () => {
  const py = await boot();
  py.FS.writeFile('/tmp/lms.pkl', new Uint8Array(readFileSync(PKL)));
  const out = JSON.parse(py.runPython(`
import json, pickle, numpy as np
from shuttle_replay.auto import jointfit
cam, g, p, fl, ex, info = pickle.load(open('/tmp/lms.pkl', 'rb'))
p2, fl2, log = jointfit.local_multistart(cam, g, p, fl, ex, info, clock=lambda: 0.0)
json.dumps({
    "finite": bool(np.isfinite(p2).all()),
    "skipped": [e for e in log if e["step"] == "local_start_skipped_nonfinite"],
    "starts": sum(e.get("starts", 0) for e in log if e["step"] == "local_multistart"),
    "coverage_before": jointfit._coverage(fl), "coverage_after": jointfit._coverage(fl2),
    "kept_blocks": sum(bool(e.get("kept")) for e in log if e["step"] == "local_multistart"),
})`));
  console.log(JSON.stringify(out));
  assert.ok(out.finite);
  assert.ok(out.skipped.length >= 1, 'the diverging start is reported, not hidden');
  assert.ok(out.starts >= 1, 'other genuine starts still run');
  assert.ok(out.coverage_after >= out.coverage_before);
});
