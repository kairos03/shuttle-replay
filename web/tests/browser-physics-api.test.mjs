// physics.mjs worker lifecycle: one worker per call, terminated on result/error/abort.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePhysics } from '../demo/browser/physics.mjs';

function fakeWorker(script) {
  const made = [];
  globalThis.Worker = class {
    constructor(url, opts) { this.url = String(url); this.opts = opts; this.terminated = false; made.push(this); }
    postMessage(msg, transfer) { this.msg = msg; this.transfer = transfer; queueMicrotask(() => script(this, msg)); }
    terminate() { this.terminated = true; }
  };
  return made;
}
const base = { pts: [0], segments: [[0, 1]], shuttle_px: [null], pose_raw: [[]], width: 4, height: 2, source_sha256: 'x', calibrationFrames: [{ width: 4, height: 2, frame_id: 0, rgb: new Uint8Array(24) }] };

test('resolves the document, forwards progress, terminates the worker', async () => {
  const made = fakeWorker((w, m) => {
    w.onmessage({ data: { type: 'progress', id: m.id, stage: 'court', fraction: 0.5 } });
    w.onmessage({ data: { type: 'result', id: m.id, doc: { schema: 'shuttle-replay/analysis/v1' } } });
  });
  const seen = [];
  const doc = await analyzePhysics({ ...base, onProgress: (p) => seen.push(p) });
  assert.equal(doc.schema, 'shuttle-replay/analysis/v1');
  assert.deepEqual(seen, [{ stage: 'court', fraction: 0.5 }]);
  assert.equal(made.length, 1);
  assert.equal(made[0].opts.type, 'module');
  assert.ok(made[0].url.endsWith('/physics-worker.mjs'));
  assert.equal(made[0].transfer.length, 1);
  assert.ok(made[0].terminated);
});

test('worker error keeps code and traceback', async () => {
  const made = fakeWorker((w, m) => w.onmessage({ data: { type: 'error', id: m.id, code: 'physics_input', message: 'physics_input: bad', traceback: 'tb' } }));
  await assert.rejects(analyzePhysics({ ...base }), (e) => e.code === 'physics_input' && e.traceback === 'tb');
  assert.ok(made[0].terminated);
});

test('abort terminates the worker and ignores late results', async () => {
  let worker;
  const made = fakeWorker((w) => { worker = w; });
  const ac = new AbortController();
  const p = analyzePhysics({ ...base, signal: ac.signal });
  await new Promise((r) => setTimeout(r, 0));
  ac.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.ok(made[0].terminated);
  worker.onmessage({ data: { type: 'result', id: 1, doc: {} } }); // late: no throw, no effect
});

test('already-aborted signal never starts a worker; missing Worker is explicit', async () => {
  const made = fakeWorker(() => {});
  const ac = new AbortController(); ac.abort();
  await assert.rejects(analyzePhysics({ ...base, signal: ac.signal }), (e) => e.name === 'AbortError');
  assert.equal(made.length, 0);
  delete globalThis.Worker;
  await assert.rejects(analyzePhysics({ ...base }), (e) => e.code === 'physics_unsupported');
});
