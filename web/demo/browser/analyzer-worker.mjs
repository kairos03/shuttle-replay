// SPDX-License-Identifier: AGPL-3.0-only
// Module worker for one automatic analysis: selected file bytes -> demux + WebCodecs decode
// (exact container PTS) -> shuttle + pose models -> court calibration and trajectory physics
// -> shuttle-replay/analysis/v1 document. One worker per request; the page terminates it on
// cancel or replace, so nothing from an old request can outlive it. No network inference.

import {
  AnalysisError, LIMITS, calibrationPass, checkBrowserSupport, checkLimits, checkPts, decoderConfig, demuxMp4,
  poseFrameArray, poseFrames, sha256Hex, throwIfAborted, trackingPass,
} from "./video.mjs";

// Overall progress bands shared by both panels' overlay.
export const BANDS = Object.freeze({ decode: [0, 0.12], models: [0.12, 0.75], calibration: [0.75, 0.78], physics: [0.78, 1] });

export function fraction(p) {
  if (typeof p === "number") return p;
  if (p && Number.isFinite(p.fraction)) return p.fraction;
  if (p && Number.isFinite(p.done) && Number.isFinite(p.total) && p.total > 0) return p.done / p.total;
  return 0;
}

// Sub-ranges (of their band) for stages that report their own 0..1 fraction. Shuttle and
// pose each count from 0 to 1, so they get separate ranges. Physics reports runtime boot
// locally and then court/players/trajectory/export on one shared 0..1 scale; that scale
// stops below 1 so the bar reaches 100% only when the analysis document actually exists.
export const SUBBANDS = Object.freeze({
  models: { load_models: [0, 0.05], models: [0, 0.05], pose_frames: [0.05, 0.12], shuttle: [0.12, 0.62], pose: [0.62, 1] },
  physics: { physics_runtime: [0, 0.2], court: [0.2, 0.97], players: [0.2, 0.97], trajectory: [0.2, 0.97], export: [0.2, 0.97], done: [0, 1] },
});

/** Map a stage-local fraction into its (sub)band; never moves backwards across one job. */
export function makeProgress(post) {
  let last = 0;
  return (band, p, stage, detail) => {
    const [a, b] = BANDS[band];
    let f = Math.max(0, Math.min(1, fraction(p)));
    const sub = SUBBANDS[band] && SUBBANDS[band][stage];
    if (sub) f = sub[0] + (sub[1] - sub[0]) * f;
    last = Math.max(last, a + (b - a) * f);
    post({ type: "progress", band, stage: stage || band, detail: detail ?? null, value: last });
  };
}

export async function analyzeFile(file, { post, signal, load = defaultLoad }) {
  const progress = makeProgress(post);
  checkBrowserSupport();
  if (file.size > LIMITS.maxBytes) checkLimits({ bytes: file.size, width: 1, height: 1, durationS: 0, frames: LIMITS.minSegmentFrames });
  progress("decode", 0, "read");
  const buffer = await file.arrayBuffer();
  throwIfAborted(signal);
  const sourceSha = await sha256Hex(buffer);
  const demux = await demuxMp4(buffer);
  const n = demux.pts.length;
  checkLimits({ bytes: file.size, width: demux.width, height: demux.height, durationS: demux.durationS, frames: n });
  checkPts(demux.pts);
  const config = await decoderConfig(demux);
  const { frames, segments, excluded } = await trackingPass(demux, config, {
    signal,
    onFrame: (done, total) => {
      if (done % 10 === 0 || done === total) progress("decode", done / total, "decode", { done, total });
    },
  });
  throwIfAborted(signal);

  const { createInference, analyzePhysics, poseStream } = await load();
  requireGpu();
  progress("models", 0, "load_models");
  const inference = await createInference({ signal, onProgress: (p) => progress("models", fraction(p), "load_models", p) });
  let result;
  let poseInput;
  try {
    // A CPU (wasm) session is numerically valid but takes tens of minutes: refuse it.
    requireGpuSessions(inference.backends);
    post({ type: "backend", backends: inference.backends });
    // Streamed when the model module accepts it; otherwise one budgeted array (see video.mjs).
    if (poseStream) poseInput = poseFrames(demux, config, { signal });
    else {
      poseInput = await poseFrameArray(demux, config, {
        signal,
        onFrame: (done, total) => {
          if (done % 10 === 0 || done === total) progress("models", done / total, "pose_frames", { done, total });
        },
      });
    }
    result = await inference.infer({
      frames, width: demux.width, height: demux.height, pts: demux.pts, segments,
      poseFrames: poseInput,
      signal,
      onProgress: (p) => progress("models", p, (p && p.stage) || "inference", p),
    });
  } finally {
    await inference.dispose?.();
  }
  const poseSize = Array.isArray(poseInput) && poseInput[0] ? [poseInput[0].width, poseInput[0].height] : null;
  frames.length = 0; // release the 512x288 and pose buffers before calibration and physics
  if (Array.isArray(poseInput)) poseInput.length = 0;
  throwIfAborted(signal);

  progress("calibration", 0, "calibration_frames");
  const calibrationFrames = await calibrationPass(demux, config, segments, { signal });
  progress("calibration", 1, "calibration_frames");
  const provenance = {
    ...(result.provenance || {}),
    integration: {
      runtime: "browser",
      demux: "mp4box.js",
      decoder: "webcodecs",
      codec: demux.codec,
      rotation: demux.rotation,
      frames: n,
      excluded_frames: excluded.length,
      segments,
      pose_frames: poseStream ? "stream" : "array",
      pose_frame_size: poseSize,
      shuttle_detected_frames: result.shuttle_px.filter((p) => p !== null).length,
      pose_frames_with_people: result.pose_raw.filter((c) => c && c.length).length,
    },
  };
  const doc = await analyzePhysics({
    pts: demux.pts, segments, shuttle_px: result.shuttle_px, pose_raw: result.pose_raw,
    width: demux.width, height: demux.height, source_sha256: sourceSha, calibrationFrames, signal, provenance,
    onProgress: (p) => progress("physics", p, (p && p.stage) || "physics", p),
  });
  throwIfAborted(signal);
  progress("physics", 1, "done");
  return { doc, sourceSha256: sourceSha, frames: n, width: demux.width, height: demux.height };
}

export const GPU_REQUIRED_MESSAGE =
  "GPU 가속(WebGPU)을 쓸 수 없어 자동 분석을 중단했습니다. CPU로는 수십 분 이상 걸립니다. " +
  "데스크톱 Chrome 설정 > 시스템 > '가능한 경우 그래픽 가속 사용'을 켜고 chrome://gpu 에서 WebGPU가 " +
  "하드웨어 가속인지 확인한 뒤 다시 시도하세요.";

/** Refuse before any model is fetched when this browser exposes no WebGPU at all. */
export function requireGpu(g = globalThis) {
  if (!g.navigator || !g.navigator.gpu) throw new AnalysisError("gpu_required", GPU_REQUIRED_MESSAGE);
}

/** Refuse when either model session fell back from WebGPU (e.g. to wasm on the CPU). */
export function requireGpuSessions(backends) {
  if (!backends || backends.tracknet !== "webgpu" || backends.pose !== "webgpu") {
    const got = backends ? `셔틀 ${backends.tracknet}, 선수 ${backends.pose}` : "알 수 없음";
    throw new AnalysisError("gpu_required", `${GPU_REQUIRED_MESSAGE} (실행 백엔드: ${got})`);
  }
}

async function defaultLoad() {
  const [inf, phys] = await Promise.all([import("./inference.mjs"), import("./physics.mjs")]);
  return { createInference: inf.createInference, analyzePhysics: phys.analyzePhysics, poseStream: inf.POSE_FRAMES_STREAM === true };
}

function errorPayload(e) {
  const code = (e && e.code) || (e && e.name === "AbortError" ? "cancelled" : "analysis_failed");
  const message = String((e && e.message) || e || "알 수 없는 오류").slice(0, 300);
  return { code, message };
}

// Worker entry: exactly one "analyze" request per worker.
if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof window === "undefined") {
  const controller = new AbortController();
  let started = false;
  self.onmessage = async ({ data }) => {
    if (!data) return;
    if (data.type === "cancel") return controller.abort();
    if (data.type !== "analyze" || started) return;
    started = true;
    const post = (m) => self.postMessage({ ...m, id: data.id });
    try {
      const out = await analyzeFile(data.file, { post, signal: controller.signal });
      post({ type: "done", doc: out.doc, sourceSha256: out.sourceSha256 });
    } catch (e) {
      post({ type: "failed", error: errorPayload(e) });
    }
  };
}

export { AnalysisError };
