// SPDX-License-Identifier: AGPL-3.0-only
// In-browser model inference: TrackNetV3 shuttle heatmaps + YOLO11s-pose candidates via
// vendored onnxruntime-web (WebGPU, falling back to single-threaded WASM). Nothing is
// uploaded: model files are fetched from this site, hash-verified, and run locally.
//
//   const inf = await createInference({ onProgress, signal });
//   const { shuttle_px, pose_raw, provenance } = await inf.infer({
//     frames,      // Uint8Array RGB 512x288 (stretched) per decoded frame
//     width, height, pts, segments,   // original source size, PTS seconds, [[a,b),...]
//     poseFrames,  // optional {width,height,rgb} per frame, or async iterable of {index,width,height,rgb}
//     onProgress, signal,
//   });
//   inf.dispose();
//
// Works on the main thread or inside a module Worker.

import {
  FRAME_BYTES, IN_H, IN_W, PLANE, SEQ_LEN, THRESHOLD, WINDOW_WEIGHTS,
  WindowAccumulator, buildWindow, checkFrame, heatmapToPx, normalizeSegments, segmentBackground,
} from './tracknet-core.mjs';
import { INPUT_SIZE, POSE_CONF, POSE_IOU, decodePose, letterboxRGB } from './pose-core.mjs';

export const MAX_FRAMES = 3600;
// infer() accepts poseFrames as an async iterable of {index,width,height,rgb} (all n frames,
// in order; frames outside segments are consumed and skipped) as well as an array.
export const POSE_FRAMES_STREAM = true;

function isPoseStream(poseFrames) {
  return poseFrames != null && !Array.isArray(poseFrames) && typeof poseFrames[Symbol.asyncIterator] === 'function';
}
const RUNTIME_URL = new URL('./runtime/', import.meta.url);
const MODELS_URL = new URL('./models/', import.meta.url);

function abortError(signal) {
  return signal?.reason instanceof Error ? signal.reason : new DOMException('Analysis cancelled', 'AbortError');
}
function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const now = () => (globalThis.performance ?? Date).now();

// Calls step(i, poseFrame) for every frame inside segs, in order. Streamed poseFrames
// ({index,width,height,rgb} for all n frames, in order) are consumed one at a time;
// frames outside segs are consumed and dropped; the iterator is always closed.
export async function forEachPoseFrame({ poseFrames, frames, segs, signal }, step) {
  const n = frames.length;
  if (!isPoseStream(poseFrames)) {
    for (const [a, b] of segs) {
      for (let i = a; i < b; i++) {
        throwIfAborted(signal);
        await step(i, poseFrames?.[i] ?? { width: IN_W, height: IN_H, rgb: frames[i] });
      }
    }
    return;
  }
  const kept = new Uint8Array(n);
  for (const [a, b] of segs) kept.fill(1, a, b);
  const it = poseFrames[Symbol.asyncIterator]();
  let expected = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const { done, value: pf } = await it.next();
      if (done) break;
      if (pf?.index !== expected) throw new RangeError(`pose frame index ${pf?.index}, expected ${expected}`);
      if (expected >= n) throw new RangeError(`pose stream has more than ${n} frames`);
      expected++;
      if (kept[pf.index]) await step(pf.index, pf);
    }
    if (expected !== n) throw new RangeError(`pose stream ended after ${expected} of ${n} frames`);
  } finally {
    await it.return?.();
  }
}

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchModel(spec, { signal, report }) {
  const res = await fetch(new URL(spec.file, MODELS_URL), { signal });
  if (!res.ok) throw new Error(`model ${spec.file}: HTTP ${res.status}`);
  const total = spec.bytes;
  const out = new Uint8Array(total);
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > total) throw new Error(`model ${spec.file}: larger than manifest (${total} bytes)`);
    out.set(value, got);
    got += value.length;
    report(got);
  }
  if (got !== total) throw new Error(`model ${spec.file}: got ${got} bytes, manifest says ${total}`);
  const hex = await sha256Hex(out);
  if (hex !== spec.sha256) throw new Error(`model ${spec.file}: sha256 ${hex} != manifest ${spec.sha256}`);
  return out;
}

async function createSession(ort, bytes, backends, attempts, name) {
  for (const ep of backends) {
    try {
      const session = await ort.InferenceSession.create(bytes, {
        // ORT-web's default NHWC layout transform gives wrong TrackNet heatmaps on WebGPU
        // (max |err| 0.44 vs PyTorch); NCHW matches to ~2e-6. See MODEL-HANDOFF.json.
        executionProviders: [ep === 'webgpu' ? { name: 'webgpu', preferredLayout: 'NCHW' } : ep],
        graphOptimizationLevel: 'all',
      });
      attempts.push({ model: name, backend: ep, ok: true });
      return { session, backend: ep };
    } catch (err) {
      attempts.push({ model: name, backend: ep, ok: false, error: String(err?.message ?? err) });
    }
  }
  throw new Error(`no ONNX Runtime backend could load ${name}: ${JSON.stringify(attempts.filter((a) => a.model === name))}`);
}

export function defaultBackends() {
  return globalThis.navigator?.gpu ? ['webgpu', 'wasm'] : ['wasm'];
}

export async function createInference({ onProgress, signal, backends = defaultBackends() } = {}) {
  if (typeof WebAssembly !== 'object' || !globalThis.crypto?.subtle) {
    throw new Error('unsupported browser: WebAssembly and crypto.subtle (secure context) are required');
  }
  throwIfAborted(signal);
  const t0 = now();
  const ort = await import('./runtime/ort.webgpu.min.mjs');
  ort.env.wasm.wasmPaths = RUNTIME_URL.href;
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated
    ? Math.max(1, Math.min(4, globalThis.navigator?.hardwareConcurrency ?? 1))
    : 1;
  ort.env.wasm.proxy = false;

  const manifestRes = await fetch(new URL('manifest.json', MODELS_URL), { signal });
  if (!manifestRes.ok) throw new Error(`model manifest: HTTP ${manifestRes.status}`);
  const manifest = await manifestRes.json();
  const specs = [manifest.models.tracknet, manifest.models.pose];
  const totalBytes = specs.reduce((s, m) => s + m.bytes, 0);
  const loaded = [0, 0];
  const report = (k) => (got) => {
    loaded[k] = got;
    const done = loaded[0] + loaded[1];
    onProgress?.({ stage: 'models', done, total: totalBytes, fraction: done / totalBytes });
  };
  const [tnBytes, poseBytes] = await Promise.all(specs.map((s, k) => fetchModel(s, { signal, report: report(k) })));
  throwIfAborted(signal);

  const attempts = [];
  const sessions = [];
  let tracknet;
  let pose;
  try {
    tracknet = await createSession(ort, tnBytes, backends, attempts, 'tracknet');
    sessions.push(tracknet.session);
    throwIfAborted(signal);
    pose = await createSession(ort, poseBytes, backends, attempts, 'pose');
    sessions.push(pose.session);
    throwIfAborted(signal);
  } catch (err) {
    await Promise.allSettled(sessions.map((s) => s.release()));
    throw err;
  }
  const loadMs = Math.round(now() - t0);
  let disposed = false;
  let busy = false;

  async function runTracknet(frames, segs, width, height, progress, sig, timing) {
    const n = frames.length;
    const shuttle = new Array(n).fill(null);
    const input = new Float32Array(27 * PLANE);
    const totalWindows = segs.reduce((s, [a, b]) => s + Math.max(0, b - a - SEQ_LEN + 1), 0);
    let doneWindows = 0;
    for (const [a, b] of segs) {
      const seg = frames.slice(a, b);
      if (seg.length < SEQ_LEN) continue; // reference: no window -> all null
      const bg = segmentBackground(seg);
      const acc = new WindowAccumulator(seg.length);
      for (let s = 0; s + SEQ_LEN <= seg.length; s++) {
        throwIfAborted(sig);
        buildWindow(bg, seg, s, input);
        const t = now();
        const feeds = { [tracknet.session.inputNames[0]]: new ort.Tensor('float32', input, [1, 27, IN_H, IN_W]) };
        const out = await tracknet.session.run(feeds);
        timing.tracknetRunMs += now() - t;
        const tensor = out[tracknet.session.outputNames[0]];
        const heat = tensor.data;
        for (const { index, heat: h } of acc.add(s, heat)) {
          shuttle[a + index] = heatmapToPx(h, width, height).xy;
        }
        tensor.dispose?.();
        doneWindows++;
        progress?.({ stage: 'shuttle', done: doneWindows, total: totalWindows, fraction: doneWindows / totalWindows });
        if (doneWindows % 4 === 0) await tick();
      }
    }
    return shuttle;
  }

  async function poseOne(pf, width, height, input, timing) {
    const { geo } = letterboxRGB(pf.rgb, pf.width, pf.height, INPUT_SIZE, input);
    const t = now();
    const out = await pose.session.run({
      [pose.session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    });
    timing.poseRunMs += now() - t;
    const tensor = out[pose.session.outputNames[0]];
    try {
      return decodePose(tensor.data, tensor.dims, geo, { srcW: pf.width, srcH: pf.height, outW: width, outH: height });
    } finally {
      tensor.dispose?.();
    }
  }

  async function runPose(frames, poseFrames, segs, width, height, progress, sig, timing) {
    const n = frames.length;
    const poseRaw = Array.from({ length: n }, () => []);
    const input = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
    const total = segs.reduce((s, [a, b]) => s + b - a, 0);
    let done = 0;
    let poseInput = null;
    const step = async (i, pf) => {
      poseInput ??= { width: pf.width, height: pf.height };
      poseRaw[i] = await poseOne(pf, width, height, input, timing);
      done++;
      progress?.({ stage: 'pose', done, total, fraction: done / total });
      if (done % 4 === 0) await tick();
    };
    await forEachPoseFrame({ poseFrames, frames, segs, signal: sig }, step);
    return { poseRaw, poseInput };
  }

  return {
    backends: { tracknet: tracknet.backend, pose: pose.backend },

    async infer({ frames, width, height, pts, segments, poseFrames, onProgress: progress, signal: sig } = {}) {
      if (disposed) throw new Error('inference disposed');
      if (busy) throw new Error('inference already running');
      if (!Array.isArray(frames) || !frames.length) throw new TypeError('frames must be a non-empty array');
      const n = frames.length;
      if (n > MAX_FRAMES) throw new RangeError(`${n} frames exceeds browser limit ${MAX_FRAMES}`);
      if (!(width > 0 && height > 0)) throw new RangeError('width/height of the original video are required');
      if (pts != null && pts.length !== n) throw new RangeError(`pts has ${pts.length} entries for ${n} frames`);
      if (poseFrames != null && !isPoseStream(poseFrames) && poseFrames.length !== n) throw new RangeError(`poseFrames has ${poseFrames.length} entries for ${n} frames`);
      frames.forEach(checkFrame);
      const segs = normalizeSegments(segments, n);
      busy = true;
      const timing = { tracknetRunMs: 0, poseRunMs: 0 };
      const t0 = now();
      try {
        const shuttle_px = await runTracknet(frames, segs, width, height, progress, sig, timing);
        const { poseRaw: pose_raw, poseInput } = await runPose(frames, poseFrames, segs, width, height, progress, sig, timing);
        return {
          shuttle_px,
          pose_raw,
          provenance: {
            runtime: { package: 'onnxruntime-web', version: manifest.runtime.version, numThreads: ort.env.wasm.numThreads, attempts },
            tracknet: {
              model: manifest.models.tracknet.file,
              sha256: manifest.models.tracknet.sha256,
              source: manifest.models.tracknet.source,
              backend: tracknet.backend,
              input: `${IN_W}x${IN_H} stretched RGB, median background + ${SEQ_LEN} frames (bg_mode concat)`,
              window_weights: [...WINDOW_WEIGHTS],
              threshold: THRESHOLD,
              observation: 'strongest 8-connected component by heat sum, heat-weighted centroid',
            },
            pose: {
              model: manifest.models.pose.file,
              sha256: manifest.models.pose.sha256,
              source: manifest.models.pose.source,
              backend: pose.backend,
              imgsz: INPUT_SIZE,
              conf: POSE_CONF,
              iou: POSE_IOU,
              input_frame: poseInput,
              input_mode: isPoseStream(poseFrames) ? 'stream' : poseFrames ? 'array' : 'tracknet_512x288',
              note: 'R5 reference ran Ultralytics predict at imgsz 1280 (rect letterbox); browser uses a static 1280 square export (square pad differs from rect pad)',
            },
            frames: n,
            segments: segs,
            timing_ms: {
              load: loadMs,
              infer: Math.round(now() - t0),
              tracknet_run: Math.round(timing.tracknetRunMs),
              pose_run: Math.round(timing.poseRunMs),
            },
          },
        };
      } finally {
        busy = false;
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const s of sessions) s.release().catch(() => {});
    },
  };
}

export { FRAME_BYTES, IN_W, IN_H };
