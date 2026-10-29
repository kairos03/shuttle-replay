// SPDX-License-Identifier: AGPL-3.0-only
// Physics worker: runs the vendored R5 court/physics Python (py/shuttle_replay/**) in
// Pyodide (WASM CPython + NumPy/SciPy/OpenCV wheels self-hosted under py/runtime/).
// No server, no upload. Also importable from Node for numerical parity tests.

export const PYODIDE_VERSION = '0.29.5';
export const PY_PACKAGES = ['numpy', 'scipy', 'opencv-python'];
export const PY_FILES = [
  'browser_physics.py',
  'shuttle_replay/__init__.py',
  'shuttle_replay/court.py',
  'shuttle_replay/auto/__init__.py',
  'shuttle_replay/auto/courtcal.py',
  'shuttle_replay/auto/export.py',
  'shuttle_replay/auto/flightfit.py',
  'shuttle_replay/auto/jointfit.py',
  'shuttle_replay/auto/players.py',
  'shuttle_replay/auto/shuttleref.py',
];

const PY_ROOT = '/home/pyodide/physics';

// Load Pyodide + packages and mount the Python sources. `readText(rel)` returns source text.
export async function bootPhysics({ indexURL, readText, onProgress = () => {} }) {
  onProgress({ stage: 'physics_runtime', fraction: 0 });
  const { loadPyodide } = await import(`${indexURL}pyodide.mjs`);
  const py = await loadPyodide({ indexURL, fullStdLib: false });
  onProgress({ stage: 'physics_runtime', fraction: 0.3 });
  await py.loadPackage(PY_PACKAGES, { checkIntegrity: true, messageCallback: () => {} });
  onProgress({ stage: 'physics_runtime', fraction: 0.9 });
  for (const rel of PY_FILES) {
    const path = `${PY_ROOT}/${rel}`;
    py.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    py.FS.writeFile(path, await readText(rel));
  }
  py.runPython(`import sys\nif ${JSON.stringify(PY_ROOT)} not in sys.path: sys.path.insert(0, ${JSON.stringify(PY_ROOT)})\nimport browser_physics`);
  onProgress({ stage: 'physics_runtime', fraction: 1 });
  return py;
}

// Run analysis in a booted Pyodide. Returns the parsed shuttle-replay/analysis/v1 document.
export function runPhysics(py, input, onProgress = () => {}) {
  const { calibrationFrames = [], ...rest } = input;
  const meta = JSON.stringify({
    pts: rest.pts,
    segments: rest.segments,
    shuttle_px: rest.shuttle_px,
    pose_raw: rest.pose_raw,
    width: rest.width,
    height: rest.height,
    source_sha256: rest.source_sha256,
    provenance: rest.provenance ?? null,
  });
  const frames = calibrationFrames.map((f) => ({
    width: f.width, height: f.height, frame_id: f.frame_id, rgb: f.rgb,
  }));
  const fn = py.runPython(`
import json, browser_physics
def _run(meta, frames, say):
    p = json.loads(meta)
    p["calibrationFrames"] = [
        {"width": f.width, "height": f.height, "frame_id": f.frame_id, "rgb": f.rgb.to_bytes()}
        for f in frames
    ]
    doc = browser_physics.analyze(p, lambda s, x: say(s, x))
    return json.dumps(doc, allow_nan=False, separators=(",", ":"))
_run`);
  const say = (stage, fraction) => onProgress({ stage, fraction });
  try {
    return JSON.parse(fn(meta, frames, say));
  } catch (err) {
    throw physicsError(err);
  } finally {
    fn.destroy();
  }
}

// Python exceptions arrive as PythonError with the full traceback; keep the last line first.
export function physicsError(err) {
  const msg = String(err?.message ?? err);
  const lines = msg.trim().split('\n');
  const last = lines[lines.length - 1] || msg;
  const code = /PhysicsInputError/.test(last) ? 'physics_input' : 'physics_failed';
  const e = new Error(`${code}: ${last}`);
  e.code = code;
  e.traceback = msg;
  return e;
}

// Worker protocol: {type:'run', id, input} -> {type:'progress'|'result'|'error', id, ...}.
const inWorker = typeof self !== 'undefined' && typeof self.postMessage === 'function'
  && typeof window === 'undefined' && typeof process === 'undefined';
if (inWorker) {
  const base = new URL('./py/', import.meta.url);
  let booted = null;
  self.onmessage = async ({ data }) => {
    if (data?.type !== 'run') return;
    const { id, input } = data;
    const onProgress = (p) => self.postMessage({ type: 'progress', id, ...p });
    try {
      booted ??= bootPhysics({
        indexURL: new URL('runtime/', base).href,
        readText: async (rel) => {
          const r = await fetch(new URL(rel, base));
          if (!r.ok) throw new Error(`physics_runtime: failed to fetch ${rel} (${r.status})`);
          return r.text();
        },
        onProgress,
      });
      const py = await booted;
      const doc = runPhysics(py, input, onProgress);
      self.postMessage({ type: 'result', id, doc });
    } catch (err) {
      const e = err?.code ? err : physicsError(err);
      self.postMessage({ type: 'error', id, code: e.code ?? 'physics_failed', message: e.message, traceback: e.traceback });
    }
  };
}
