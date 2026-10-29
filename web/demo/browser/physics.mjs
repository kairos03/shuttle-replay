// SPDX-License-Identifier: AGPL-3.0-only
// Browser physics entry: automatic court calibration + R5 shared-contact gravity/drag
// joint trajectory fit, executed in a dedicated Pyodide worker (physics-worker.mjs).
//
// analyzePhysics({pts, segments, shuttle_px, pose_raw, width, height, source_sha256,
//   calibrationFrames, onProgress, signal, provenance}) -> shuttle-replay/analysis/v1 doc
//
// segments: [[a, b), ...] half-open source frame-index ranges (camera-cut free).
// calibrationFrames: [{width, height, rgb: Uint8Array (RGB, w*h*3), frame_id}] from the
//   longest segment (<= 25, evenly sampled; frame_id inside that segment). Empty => the
//   document reports calibration unavailable (no players on court, no shuttle reference).
// onProgress({stage, fraction}): stage in physics_runtime|court|players|trajectory|export.
// signal: AbortSignal; abort terminates the worker (error name 'AbortError').
// Each call owns one worker which is terminated on completion, error or abort.

export function analyzePhysics({
  pts, segments, shuttle_px, pose_raw, width, height, source_sha256,
  calibrationFrames = [], onProgress = () => {}, signal, provenance,
  workerURL = new URL('./physics-worker.mjs', import.meta.url),
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    if (typeof Worker === 'undefined') {
      return reject(Object.assign(new Error('physics_unsupported: Web Workers are unavailable'), { code: 'physics_unsupported' }));
    }
    if (typeof WebAssembly === 'undefined') {
      return reject(Object.assign(new Error('physics_unsupported: WebAssembly is unavailable'), { code: 'physics_unsupported' }));
    }
    const worker = new Worker(workerURL, { type: 'module', name: 'shuttle-replay-physics' });
    const id = 1;
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      fn(v);
    };
    const onAbort = () => finish(reject, abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data?.id !== id) return;
      if (data.type === 'progress') onProgress({ stage: data.stage, fraction: data.fraction });
      else if (data.type === 'result') finish(resolve, data.doc);
      else if (data.type === 'error') {
        finish(reject, Object.assign(new Error(data.message), { code: data.code, traceback: data.traceback }));
      }
    };
    worker.onerror = (ev) => {
      ev.preventDefault?.();
      finish(reject, Object.assign(new Error(`physics_worker: ${ev.message || 'worker failed to load'}`), { code: 'physics_worker' }));
    };
    const transfer = calibrationFrames.map((f) => f.rgb.buffer).filter((b, i, all) => all.indexOf(b) === i);
    worker.postMessage({
      type: 'run', id,
      input: { pts, segments, shuttle_px, pose_raw, width, height, source_sha256, calibrationFrames, provenance },
    }, transfer);
  });
}

function abortError() {
  try {
    return new DOMException('physics analysis aborted', 'AbortError');
  } catch {
    return Object.assign(new Error('physics analysis aborted'), { name: 'AbortError' });
  }
}
