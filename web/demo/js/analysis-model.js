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
  maxPlayersPerFrame: 16,
  maxCalibrationAnchors: 64,
  maxAbsCourtM: 100,
  maxStatusLength: 80,
  maxAssumptions: 32,
  maxNoteLength: 1000,
});

const SHUTTLE_MAP_TOP_STATUS = new Set(["conditional_reference", "unavailable"]);
const SHUTTLE_MAP_REF_STATUS = new Set(["estimated", "interpolated", "reference"]);
const SAME_XY_M = 1e-6;
const SAME_PTS_S = 1e-6;

import { PLAYER_IDS, PLAYER_SHORT } from "./players.js";

const PLAYER_ID_SET = new Set(PLAYER_IDS);
const CALIBRATION_STATUS = new Set(["manual_reference", "unavailable"]);

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

function shortText(v, where) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") fail(`${where}: 문자열이어야 합니다.`);
  return v.slice(0, LIMITS.maxStatusLength);
}

function courtPoint(v, where) {
  const p = point(v, 2, where);
  if (p && (Math.abs(p[0]) > LIMITS.maxAbsCourtM || Math.abs(p[1]) > LIMITS.maxAbsCourtM)) {
    fail(`${where}: court_xy_m 값이 코트 기준으로 너무 큽니다.`);
  }
  return p;
}

const unit = (v) => finite(v) && v >= 0 && v <= 1;

/**
 * Optional top-level player_calibration. Projection (use of per-frame court_xy_m) is
 * permitted only for a manual_reference with a finite, non-degenerate 3x3 homography and
 * at least four anchors. Absent or unavailable => no floor positions are kept.
 */
function parsePlayerCalibration(c) {
  const none = Object.freeze({ status: "unavailable", h: null, anchors: Object.freeze([]), note: null, permitsProjection: false });
  if (c === undefined || c === null) return none;
  const where = "player_calibration";
  if (!isObj(c)) fail(`${where} 가 객체가 아닙니다.`);
  if (!CALIBRATION_STATUS.has(c.status)) fail(`${where}.status 를 알 수 없습니다.`);
  let h = null;
  if (c.image_to_court_h !== null && c.image_to_court_h !== undefined) {
    const rows = c.image_to_court_h;
    if (!Array.isArray(rows) || rows.length !== 3) fail(`${where}.image_to_court_h 는 3x3 행렬이어야 합니다.`);
    h = Object.freeze(rows.map((r, i) => point(r, 3, `${where}.image_to_court_h[${i}]`)));
  }
  const rawAnchors = c.anchors === undefined || c.anchors === null ? [] : c.anchors;
  if (!Array.isArray(rawAnchors) || rawAnchors.length > LIMITS.maxCalibrationAnchors) fail(`${where}.anchors 배열이 올바르지 않습니다.`);
  const anchors = rawAnchors.map((a, i) => {
    const w = `${where}.anchors[${i}]`;
    if (!isObj(a)) fail(`${w} 가 객체가 아닙니다.`);
    const imagePx = point(a.image_px, 2, `${w}.image_px`);
    const courtXy = courtPoint(a.court_xy_m, `${w}.court_xy_m`);
    if (!imagePx || !courtXy) fail(`${w}: image_px 와 court_xy_m 이 필요합니다.`);
    return Object.freeze({ imagePx, courtXy, label: shortText(a.label, `${w}.label`) });
  });
  const det = h
    ? h[0][0] * (h[1][1] * h[2][2] - h[1][2] * h[2][1]) -
      h[0][1] * (h[1][0] * h[2][2] - h[1][2] * h[2][0]) +
      h[0][2] * (h[1][0] * h[2][1] - h[1][1] * h[2][0])
    : 0;
  const permitsProjection = c.status === "manual_reference" && h !== null && Math.abs(det) > 1e-12 && anchors.length >= 4;
  return Object.freeze({
    status: c.status,
    h,
    anchors: Object.freeze(anchors),
    note: typeof c.note === "string" ? c.note.slice(0, LIMITS.maxIdLength) : null,
    permitsProjection,
  });
}

/**
 * Optional top-level shuttle_map_reference: display-only conditional court estimate of the
 * shuttle (camera/height/flight hypothesis), never measured 3D. Unknown extra keys are ignored.
 */
function parseShuttleMapTop(c) {
  const none = Object.freeze({ status: "unavailable", method: null, note: null, assumptions: Object.freeze([]), coordinateSystem: null });
  if (c === undefined || c === null) return none;
  const where = "shuttle_map_reference";
  if (!isObj(c)) fail(`${where} 가 객체가 아닙니다.`);
  if (!SHUTTLE_MAP_TOP_STATUS.has(c.status)) fail(`${where}.status 를 알 수 없습니다.`);
  const str = (v, w, max) => {
    if (v === undefined || v === null) return null;
    if (typeof v !== "string") fail(`${where}.${w} 는 문자열이어야 합니다.`);
    return v.slice(0, max);
  };
  const raw = c.assumptions === undefined || c.assumptions === null ? [] : c.assumptions;
  if (!Array.isArray(raw) || raw.length > LIMITS.maxAssumptions) fail(`${where}.assumptions 배열이 올바르지 않습니다.`);
  const assumptions = raw.map((a, i) => str(a, `assumptions[${i}]`, LIMITS.maxNoteLength) ?? fail(`${where}.assumptions[${i}] 가 비어 있습니다.`));
  let coordinateSystem = null;
  if (c.coordinate_system !== undefined && c.coordinate_system !== null) {
    if (!isObj(c.coordinate_system)) fail(`${where}.coordinate_system 이 객체가 아닙니다.`);
    // Only short string facts are kept (shown with textContent); nested values are ignored.
    const kept = Object.entries(c.coordinate_system)
      .filter(([, v]) => typeof v === "string")
      .slice(0, 16)
      .map(([k, v]) => [k.slice(0, LIMITS.maxStatusLength), v.slice(0, LIMITS.maxIdLength)]);
    coordinateSystem = Object.freeze(Object.fromEntries(kept));
  }
  return Object.freeze({
    status: c.status,
    method: str(c.method, "method", LIMITS.maxIdLength),
    note: str(c.note, "note", LIMITS.maxNoteLength),
    assumptions: Object.freeze(assumptions),
    coordinateSystem,
  });
}

/** One frame's shuttle_map_reference: shape only; cross-frame checks run after all frames parse. */
function parseShuttleMapRef(r, where, segmentKey, flightsById) {
  if (r === undefined || r === null) return null;
  const w = `${where}.shuttle_map_reference`;
  if (!isObj(r)) fail(`${w} 가 객체가 아닙니다.`);
  if (!SHUTTLE_MAP_REF_STATUS.has(r.status)) fail(`${w}.status 를 알 수 없습니다.`);
  const xy = courtPoint(r.xy_m, `${w}.xy_m`);
  if (!xy) fail(`${w}.xy_m 이 필요합니다.`);
  const xyz = point(r.xyz_m, 3, `${w}.xyz_m`);
  if (xyz && (Math.abs(xyz[0] - xy[0]) > SAME_XY_M || Math.abs(xyz[1] - xy[1]) > SAME_XY_M || Math.abs(xyz[2]) > LIMITS.maxAbsCourtM)) {
    fail(`${w}: xy_m 이 xyz_m 의 앞 두 값과 다릅니다.`);
  }
  const flightId = text(r.flight_id, `${w}.flight_id`, { optional: true });
  // A known flight id must belong to this frame's segment; unknown ids stay opaque labels.
  const fl = flightId === null ? null : flightsById.get(flightId);
  if (fl && segmentKey !== null && fl.segmentKey !== segmentKey) fail(`${w}.flight_id 의 segment 가 프레임과 다릅니다.`);
  const refId = r.reference_frame_id ?? null;
  const refPts = r.reference_pts_s ?? null;
  if (refId !== null && !Number.isInteger(refId)) fail(`${w}.reference_frame_id 가 정수가 아닙니다.`);
  if (refPts !== null && !finite(refPts)) fail(`${w}.reference_pts_s 가 유한한 숫자가 아닙니다.`);
  if ((refId === null) !== (refPts === null)) fail(`${w}: reference_frame_id 와 reference_pts_s 는 함께 있어야 합니다.`);
  if (r.status === "reference" && refId === null) fail(`${w}: 참조 상태에는 reference_frame_id 가 필요합니다.`);
  return Object.freeze({ xy, xyz, status: r.status, referenceFrameId: refId, referencePts: refPts, flightId });
}

/**
 * Bounded O(N) cross-frame pass: a reference hold points at a different estimated seed frame
 * in the same segment, keeps that seed's own pts (never refreshed) and its position.
 * Other statuses may name a seed only under the same segment/time rules.
 */
function checkShuttleMapRefs(frames, refs) {
  const byId = new Map();
  frames.forEach((fr, i) => byId.set(fr.frameId, i));
  refs.forEach((r, i) => {
    if (!r || r.referenceFrameId === null) return;
    const w = `frames[${i}].shuttle_map_reference`;
    const j = byId.get(r.referenceFrameId);
    if (j === undefined) fail(`${w}: 존재하지 않는 reference_frame_id 입니다.`);
    const seed = frames[j];
    if (frames[i].segmentKey === null || seed.segmentKey !== frames[i].segmentKey) fail(`${w}: 참조 프레임의 segment 가 다릅니다.`);
    if (Math.abs(seed.pts - r.referencePts) > SAME_PTS_S) fail(`${w}: reference_pts_s 가 참조 프레임 pts 와 다릅니다.`);
    if (r.status !== "reference") {
      if (j !== i) fail(`${w}: 추정/보간 상태는 자기 프레임만 참조할 수 있습니다.`);
      return;
    }
    if (j === i) fail(`${w}: 참조 상태가 자기 자신을 가리킵니다.`);
    const s = refs[j];
    if (!s || s.status !== "estimated") fail(`${w}: 참조 프레임에 계산된 추정 위치가 없습니다.`);
    if (Math.abs(s.xy[0] - r.xy[0]) > SAME_XY_M || Math.abs(s.xy[1] - r.xy[1]) > SAME_XY_M) fail(`${w}: 참조 위치가 참조 프레임과 다릅니다.`);
  });
}

// Older v1 files carry two inherited {label, score, box} entries: accepted, never drawn.
const isLegacyPlayer = (p) => isObj(p) && !("id" in p) && "label" in p;

/** Optional per-frame players. Excluded frames and frames without projection lose nothing else. */
function parsePlayers(raw, where, { excluded, permitsProjection }) {
  if (raw === undefined || raw === null) return Object.freeze([]);
  if (!Array.isArray(raw)) fail(`${where}.players 는 배열이어야 합니다.`);
  if (raw.length > LIMITS.maxPlayersPerFrame) fail(`${where}.players 가 너무 많습니다 (최대 ${LIMITS.maxPlayersPerFrame}).`);
  const legacy = raw.filter(isLegacyPlayer).length;
  if (legacy > 0) {
    if (legacy !== raw.length) fail(`${where}.players: 이전 형식과 새 형식이 섞여 있습니다.`);
    return null;
  }
  const seen = new Set();
  const out = raw.map((p, i) => {
    const w = `${where}.players[${i}]`;
    if (!isObj(p)) fail(`${w} 가 객체가 아닙니다.`);
    if (!PLAYER_ID_SET.has(p.id)) fail(`${w}.id: 알 수 없는 선수 id 입니다.`);
    if (seen.has(p.id)) fail(`${w}.id: 선수 id 가 중복됩니다.`);
    seen.add(p.id);
    const box = point(p.box_px, 4, `${w}.box_px`);
    if (!box) fail(`${w}.box_px 가 필요합니다.`);
    if (box[2] < box[0] || box[3] < box[1]) fail(`${w}.box_px: x2/y2 가 x1/y1 보다 작습니다.`);
    const anchor = point(p.anchor_px, 2, `${w}.anchor_px`);
    const courtXy = courtPoint(p.court_xy_m, `${w}.court_xy_m`);
    let keypoints = null;
    if (p.keypoints !== null && p.keypoints !== undefined) {
      if (!Array.isArray(p.keypoints) || p.keypoints.length !== 17) fail(`${w}.keypoints 는 17개여야 합니다.`);
      keypoints = Object.freeze(
        p.keypoints.map((k, j) => {
          const q = point(k, 3, `${w}.keypoints[${j}]`);
          if (!q || !unit(q[2])) fail(`${w}.keypoints[${j}]: score 는 0~1 이어야 합니다.`);
          return q;
        }),
      );
    }
    if (p.score !== null && p.score !== undefined && !unit(p.score)) fail(`${w}.score 는 0~1 숫자여야 합니다.`);
    return Object.freeze({
      id: p.id,
      short: PLAYER_SHORT[p.id],
      box,
      anchor,
      // Floor position only under a validated manual reference; never derived here.
      courtXy: permitsProjection ? courtXy : null,
      keypoints,
      score: finite(p.score) ? p.score : null,
      status: shortText(p.status, `${w}.status`),
      anchorStatus: shortText(p.anchor_status, `${w}.anchor_status`),
    });
  });
  // Excluded camera-cut frames never carry drawable players, whatever the file says.
  return Object.freeze(excluded ? [] : out);
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

  const playerCalibration = parsePlayerCalibration(obj.player_calibration);
  const shuttleMapReference = parseShuttleMapTop(obj.shuttle_map_reference);
  const mapRefs = [];
  let hasPlayers = false;
  let legacyPlayerEntries = 0;

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
    let players = parsePlayers(f.players, where, {
      excluded: key === null,
      permitsProjection: playerCalibration.permitsProjection,
    });
    if (players === null) {
      legacyPlayerEntries += f.players.length;
      players = Object.freeze([]);
    } else if (Array.isArray(f.players) && f.players.length > 0) hasPlayers = true;
    // Validated even on cut frames; drawable only inside a segment.
    const mapRef = parseShuttleMapRef(f.shuttle_map_reference, where, key, flightsById);
    mapRefs.push(key === null ? null : mapRef);
    return {
      index: i,
      frameId: f.frame_id,
      pts: f.pts_s,
      segmentKey: key,
      layer,
      observed,
      modelPx,
      modelXyz,
      modelFlightId: flightId,
      players,
      shuttleMapRef: null,
    };
  });

  checkShuttleMapRefs(frames, mapRefs);
  // Top unavailable (or absent) => no drawable map references at all.
  const mapOn = shuttleMapReference.status === "conditional_reference";
  let hasShuttleMapRef = false;
  for (const fr of frames) {
    fr.shuttleMapRef = mapOn ? mapRefs[fr.index] : null;
    if (fr.shuttleMapRef) hasShuttleMapRef = true;
    Object.freeze(fr);
  }

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
    playerCalibration,
    hasPlayers,
    legacyPlayerEntries,
    shuttleMapReference,
    hasShuttleMapRef,
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
