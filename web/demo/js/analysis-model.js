// SPDX-License-Identifier: AGPL-3.0-only
// Pure, DOM-free parsing and timing logic for the shuttle-replay web viewer.
// Every value read from an analysis file is treated as untrusted input.

export const SCHEMA = "shuttle-replay/analysis/v1";

export const LIMITS = Object.freeze({
  maxBytes: 64 * 1024 * 1024,
  maxFrames: 200000,
  maxFlights: 5000,
  maxSegments: 1000,
  maxIdLength: 200,
  maxAbsCoord: 1e6,
});

const LAYERS = new Set(["excluded_camera_cut", "conditional_model", "observed_pixel", "none"]);

export class AnalysisError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnalysisError";
  }
}

const fail = (msg) => {
  throw new AnalysisError(msg);
};
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);

function segKey(v, where) {
  if (v === null) return null;
  if (Number.isInteger(v)) return `n:${v}`;
  if (typeof v === "string" && v.length > 0 && v.length <= LIMITS.maxIdLength) return `s:${v}`;
  return fail(`${where}: segment_id 형식이 올바르지 않습니다.`);
}

function point(v, n, where) {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || v.length !== n) fail(`${where}: 좌표는 숫자 ${n}개 배열이어야 합니다.`);
  for (const x of v) {
    if (!finite(x) || Math.abs(x) > LIMITS.maxAbsCoord) fail(`${where}: 좌표에 유한하지 않은 값이 있습니다.`);
  }
  return Object.freeze(v.slice());
}

function text(v, where, { optional = false } = {}) {
  if (optional && (v === null || v === undefined)) return null;
  if (typeof v !== "string" || v.length === 0 || v.length > LIMITS.maxIdLength) {
    fail(`${where}: 문자열 식별자가 필요합니다.`);
  }
  return v;
}

/** Parse untrusted JSON text into a validated, frozen viewer model. */
export function parseAnalysisText(raw) {
  if (typeof raw !== "string") fail("분석 파일을 텍스트로 읽지 못했습니다.");
  if (raw.length > LIMITS.maxBytes) fail("분석 파일이 너무 큽니다 (최대 64 MB).");
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    fail("JSON 형식이 아닙니다. shuttle-replay analysis.json 파일을 선택하세요.");
  }
  return validateAnalysis(obj);
}

export function validateAnalysis(obj) {
  if (!isObj(obj)) fail("분석 파일 최상위가 객체가 아닙니다.");
  if (obj.schema !== SCHEMA) {
    const got = typeof obj.schema === "string" ? obj.schema.slice(0, 80) : "없음";
    fail(`지원하지 않는 스키마입니다 (받은 값: ${got}). ${SCHEMA} 만 지원합니다.`);
  }

  // Segments
  if (!Array.isArray(obj.segments) || obj.segments.length > LIMITS.maxSegments) {
    fail("segments 배열이 없거나 너무 깁니다.");
  }
  const segments = new Map();
  for (const [i, s] of obj.segments.entries()) {
    if (!isObj(s)) fail(`segments[${i}] 가 객체가 아닙니다.`);
    const key = segKey(s.segment_id, `segments[${i}]`);
    if (key === null) fail(`segments[${i}]: segment_id 가 null 입니다.`);
    if (segments.has(key)) fail(`segments[${i}]: segment_id 가 중복됩니다.`);
    if (!finite(s.start_s) || !finite(s.end_s) || s.end_s < s.start_s) {
      fail(`segments[${i}]: start_s/end_s 가 올바르지 않습니다.`);
    }
    segments.set(key, Object.freeze({ key, id: s.segment_id, startS: s.start_s, endS: s.end_s }));
  }

  // Flights
  if (!Array.isArray(obj.flights) || obj.flights.length > LIMITS.maxFlights) {
    fail("flights 배열이 없거나 너무 깁니다.");
  }
  const flightsById = new Map();
  const flights = obj.flights.map((f, i) => {
    const where = `flights[${i}]`;
    if (!isObj(f)) fail(`${where} 가 객체가 아닙니다.`);
    const id = text(f.id, `${where}.id`);
    if (flightsById.has(id)) fail(`${where}: flight id 가 중복됩니다.`);
    const key = segKey(f.segment_id, where);
    const seg = segments.get(key);
    if (!seg) fail(`${where}: 존재하지 않는 segment 를 참조합니다.`);
    if (!finite(f.t0_s)) fail(`${where}: t0_s 가 유한한 숫자가 아닙니다.`);
    if (typeof f.accepted !== "boolean") fail(`${where}: accepted 는 true/false 여야 합니다.`);
    const tEnd = f.t_end_s === undefined || f.t_end_s === null ? null : f.t_end_s;
    if (tEnd !== null && (!finite(tEnd) || tEnd < f.t0_s)) fail(`${where}: t_end_s 가 올바르지 않습니다.`);
    if (f.accepted && tEnd === null) fail(`${where}: 채택된 비행에 t_end_s 가 없습니다.`);
    const speed = f.model_speed_coarse_km_h;
    if (speed !== undefined && speed !== null && !finite(speed)) fail(`${where}: 모델 속도가 유한하지 않습니다.`);
    let landing = null;
    if (isObj(f.landing)) landing = { xy: point(f.landing.xy_m, 2, `${where}.landing.xy_m`) };
    const flight = Object.freeze({
      id,
      contactId: text(f.contact_id, `${where}.contact_id`, { optional: true }),
      segmentKey: key,
      t0: f.t0_s,
      tEnd,
      accepted: f.accepted,
      status: typeof f.status === "string" ? f.status.slice(0, 80) : "unknown",
      endType: typeof f.end_type === "string" ? f.end_type.slice(0, 80) : "unknown",
      speedCoarseKmH: finite(speed) ? speed : null,
      landing,
    });
    flightsById.set(id, flight);
    return flight;
  });

  // Frames
  const rawFrames = obj.frames;
  if (!Array.isArray(rawFrames) || rawFrames.length === 0) fail("frames 가 비어 있습니다.");
  if (rawFrames.length > LIMITS.maxFrames) fail(`frames 가 너무 많습니다 (최대 ${LIMITS.maxFrames}).`);
  const pts = new Float64Array(rawFrames.length);
  let prevId = null;
  const frames = rawFrames.map((f, i) => {
    const where = `frames[${i}]`;
    if (!isObj(f)) fail(`${where} 가 객체가 아닙니다.`);
    if (!Number.isInteger(f.frame_id)) fail(`${where}: frame_id 가 정수가 아닙니다.`);
    if (prevId !== null && f.frame_id <= prevId) fail(`${where}: frame_id 가 증가하지 않습니다.`);
    if (!finite(f.pts_s)) fail(`${where}: pts_s 가 유한한 숫자가 아닙니다.`);
    if (i > 0 && f.pts_s <= pts[i - 1]) fail(`${where}: pts_s 가 단조 증가하지 않습니다.`);
    pts[i] = f.pts_s;
    prevId = f.frame_id;
    const key = segKey(f.segment_id ?? null, where);
    if (key !== null && !segments.has(key)) fail(`${where}: 존재하지 않는 segment 를 참조합니다.`);
    const layer = f.layer;
    if (!LAYERS.has(layer)) fail(`${where}: 알 수 없는 layer 입니다.`);
    let observed = point(f.shuttle_observed_px, 2, `${where}.shuttle_observed_px`);
    let modelPx = point(f.shuttle_model_px, 2, `${where}.shuttle_model_px`);
    let modelXyz = point(f.shuttle_model_xyz_m, 3, `${where}.shuttle_model_xyz_m`);
    let flightId = f.model_flight_id ?? null;
    if (key === null || layer === "excluded_camera_cut") {
      if (key !== null || layer !== "excluded_camera_cut") {
        fail(`${where}: 카메라 컷 프레임은 segment_id 가 null 이고 layer 가 excluded_camera_cut 이어야 합니다.`);
      }
      // Excluded frames never carry drawable data, whatever the file says.
      observed = modelPx = modelXyz = null;
      flightId = null;
    } else if (flightId !== null) {
      const fl = flightsById.get(flightId);
      if (!fl) fail(`${where}: 존재하지 않는 비행(model_flight_id)을 참조합니다.`);
      if (!fl.accepted) fail(`${where}: 채택되지 않은 비행의 모델 점이 들어 있습니다.`);
      if (fl.segmentKey !== key) fail(`${where}: 모델 비행과 프레임의 segment 가 다릅니다.`);
      if (f.pts_s < fl.t0 - 1e-6 || f.pts_s > fl.tEnd + 1e-6) fail(`${where}: 모델 비행 시간 범위 밖입니다.`);
      if (!modelPx || !modelXyz) fail(`${where}: 모델 비행 프레임에 모델 좌표가 없습니다.`);
    } else if (modelPx || modelXyz) {
      fail(`${where}: model_flight_id 없이 모델 좌표가 있습니다.`);
    }
    return Object.freeze({
      index: i,
      frameId: f.frame_id,
      pts: f.pts_s,
      segmentKey: key,
      layer,
      observed,
      modelPx,
      modelXyz,
      modelFlightId: flightId,
    });
  });

  const model = {
    schema: SCHEMA,
    synthetic: obj.synthetic === true,
    sourceVideo: typeof obj.source_video === "string" ? obj.source_video.slice(0, LIMITS.maxIdLength) : null,
    segments,
    flights: Object.freeze(flights),
    flightsById,
    frames: Object.freeze(frames),
    pts,
    nominalFrameS: medianStep(pts),
  };
  model.flightWindowEnds = flightWindowEnds(flights, segments);
  model.flightOfFrame = flightContexts(frames, flights, model.flightWindowEnds);
  return Object.freeze(model);
}

function medianStep(pts) {
  if (pts.length < 2) return 1 / 30;
  const d = [];
  for (let i = 1; i < pts.length; i++) d.push(pts[i] - pts[i - 1]);
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}

/**
 * Flight window end: its fitted end, else the next strictly later contact (t0) in the
 * same segment, else the segment end. Computed for all flights at once by sorting
 * each segment's flights by t0: O(F log F).
 */
function flightWindowEnds(flights, segments) {
  const ends = new Float64Array(flights.length);
  const bySeg = new Map();
  flights.forEach((f, i) => {
    if (!bySeg.has(f.segmentKey)) bySeg.set(f.segmentKey, []);
    bySeg.get(f.segmentKey).push(i);
  });
  for (const [key, idx] of bySeg) {
    idx.sort((a, b) => flights[a].t0 - flights[b].t0 || a - b);
    const segEnd = segments.get(key).endS;
    let nextT0 = Infinity; // smallest t0 strictly greater than the current group's t0
    for (let j = idx.length - 1; j >= 0; ) {
      let k = j;
      while (k >= 0 && flights[idx[k]].t0 === flights[idx[j]].t0) k--;
      for (let x = j; x > k; x--) {
        const f = flights[idx[x]];
        ends[idx[x]] = f.tEnd !== null ? f.tEnd : Math.min(segEnd, nextT0);
      }
      nextT0 = flights[idx[j]].t0;
      j = k;
    }
  }
  return ends;
}

/**
 * Per-frame flight context: among flights of the frame's segment with
 * t0 <= pts <= windowEnd, the one with the greatest t0 (ties: earliest listed).
 * Sweep over frames (pts increase) with a max-heap and lazy expiry:
 * O((frames + flights) log flights).
 */
function flightContexts(frames, flights, ends) {
  const out = new Int32Array(frames.length).fill(-1);
  const bySeg = new Map();
  flights.forEach((f, i) => {
    if (!bySeg.has(f.segmentKey)) bySeg.set(f.segmentKey, []);
    bySeg.get(f.segmentKey).push(i);
  });
  for (const idx of bySeg.values()) idx.sort((a, b) => flights[a].t0 - flights[b].t0 || a - b);
  const state = new Map(); // segmentKey -> { next, heap }
  // Heap order: greater t0 first, then lower flight index.
  const before = (a, b) => flights[a].t0 > flights[b].t0 || (flights[a].t0 === flights[b].t0 && a < b);
  const push = (h, v) => {
    h.push(v);
    for (let i = h.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!before(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  };
  const pop = (h) => {
    const last = h.pop();
    if (h.length === 0) return;
    h[0] = last;
    for (let i = 0; ; ) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && before(h[l], h[m])) m = l;
      if (r < h.length && before(h[r], h[m])) m = r;
      if (m === i) break;
      [h[i], h[m]] = [h[m], h[i]];
      i = m;
    }
  };
  for (const fr of frames) {
    const idx = fr.segmentKey === null ? undefined : bySeg.get(fr.segmentKey);
    if (!idx) continue;
    let st = state.get(fr.segmentKey);
    if (!st) state.set(fr.segmentKey, (st = { next: 0, heap: [] }));
    while (st.next < idx.length && flights[idx[st.next]].t0 <= fr.pts) push(st.heap, idx[st.next++]);
    // Frame pts only increase, so an expired window never becomes active again.
    while (st.heap.length && !(fr.pts <= ends[st.heap[0]])) pop(st.heap);
    if (st.heap.length) out[fr.index] = st.heap[0];
  }
  return Array.from(out);
}

/**
 * Map an analysis time (seconds, same clock as pts_s) to a frame.
 * status: "ok" | "before" (earlier than first frame) | "after" (past last frame's span).
 */
export function lookupFrame(model, t) {
  const { pts } = model;
  if (!finite(t)) return { index: -1, status: "before" };
  const eps = 1e-6;
  if (t < pts[0] - eps) return { index: -1, status: "before" };
  const last = pts.length - 1;
  if (t > pts[last] + model.nominalFrameS * 1.5) return { index: -1, status: "after" };
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid] <= t + eps) lo = mid;
    else hi = mid - 1;
  }
  return { index: lo, status: "ok" };
}

/** First frame at or after analysis time `t` (e.g. a reviewed contact t0), or -1. */
export function firstFrameAtOrAfter(model, t) {
  const { pts } = model;
  let lo = 0;
  let hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid] < t - 1e-6) lo = mid + 1;
    else hi = mid;
  }
  return lo < pts.length ? lo : -1;
}

export function stepIndex(model, index, delta) {
  const n = model.frames.length;
  if (index < 0) return delta >= 0 ? 0 : n - 1;
  return Math.min(n - 1, Math.max(0, index + delta));
}

/** Analysis time to seek to so the decoder lands inside frame `index` (not on its boundary). */
export function seekTimeForIndex(model, index) {
  const { pts } = model;
  const next = index + 1 < pts.length ? pts[index + 1] : pts[index] + model.nominalFrameS;
  return pts[index] + Math.min(0.002, (next - pts[index]) / 4);
}

/** Video element time <-> analysis time. analysis = video + offset. */
export const toAnalysisTime = (videoTime, offsetS) => videoTime + offsetS;
export const toVideoTime = (analysisTime, offsetS) => analysisTime - offsetS;

function samePiece(model, a, b, kind) {
  if (a.segmentKey === null || a.segmentKey !== b.segmentKey) return false;
  if (b.frameId - a.frameId !== 1) return false;
  if (kind === "model") return a.modelFlightId !== null && a.modelFlightId === b.modelFlightId;
  return model.flightOfFrame[a.index] === model.flightOfFrame[b.index];
}

function hasPoint(fr, kind) {
  if (fr.segmentKey === null) return false;
  return kind === "model" ? fr.modelPx !== null && fr.modelFlightId !== null : fr.observed !== null;
}

/**
 * Trail ending at `index` for kind "observed" | "model": consecutive frames only,
 * never crossing a camera cut, null segment, detection gap, or a flight boundary.
 */
export function trailIndices(model, index, kind, maxLen = 12) {
  const out = [];
  if (index < 0 || index >= model.frames.length) return out;
  let cur = model.frames[index];
  if (!hasPoint(cur, kind)) return out;
  out.push(index);
  for (let i = index - 1; i >= 0 && out.length < maxLen; i--) {
    const prev = model.frames[i];
    if (!hasPoint(prev, kind) || !samePiece(model, prev, cur, kind)) break;
    out.push(i);
    cur = prev;
  }
  return out.reverse();
}

/** Human-readable state of a frame for the status line (Korean). */
export function frameState(model, index, lookupStatus = "ok") {
  if (lookupStatus === "before") return { kind: "outside", label: "분석 시작 전 — 오버레이 없음" };
  if (lookupStatus === "after") return { kind: "outside", label: "분석 범위 밖 — 오버레이 없음" };
  const fr = model.frames[index];
  if (fr.layer === "excluded_camera_cut") return { kind: "cut", label: "카메라 컷 (제외 구간) — 오버레이 없음" };
  if (fr.observed === null && fr.modelPx === null) return { kind: "gap", label: "검출 없음 · 모델 없음" };
  if (fr.observed === null) return { kind: "gap", label: "검출 공백 — 모델만 표시" };
  if (fr.modelPx === null) return { kind: "observed", label: "관측만 있음 — 채택된 모델 없음" };
  return { kind: "both", label: "관측 + 조건부 모델" };
}

/** Count drawable pixel points outside the video's intrinsic frame (they are never drawn). */
export function outOfBoundsCount(model, width, height) {
  let n = 0;
  for (const fr of model.frames) {
    for (const p of [fr.observed, fr.modelPx]) {
      if (p && !inImage(p, width, height)) n++;
    }
  }
  return n;
}

export const inImage = (p, w, h) => p[0] >= 0 && p[1] >= 0 && p[0] <= w && p[1] <= h;

/** Compare analysis span with loaded video duration; returns Korean warning or null. */
export function durationMismatch(model, videoDuration, offsetS) {
  if (!finite(videoDuration) || videoDuration <= 0) return null;
  const lastVideo = toVideoTime(model.pts[model.pts.length - 1], offsetS);
  const firstVideo = toVideoTime(model.pts[0], offsetS);
  const tol = model.nominalFrameS * 2;
  if (lastVideo > videoDuration + tol) {
    return `영상(${videoDuration.toFixed(2)}초)이 분석 마지막 프레임(${lastVideo.toFixed(2)}초)보다 짧습니다. 영상 끝 이후 오버레이는 그리지 않습니다.`;
  }
  if (firstVideo < -tol) return "분석 시작 시각이 영상 시작보다 앞섭니다. 시간 오프셋을 확인하세요.";
  if (videoDuration > lastVideo + 1) {
    return "영상이 분석 범위보다 깁니다. 범위 밖 구간에는 오버레이가 없습니다.";
  }
  return null;
}
