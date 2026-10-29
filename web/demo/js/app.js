// SPDX-License-Identifier: AGPL-3.0-only
// DOM wiring for the minimal shuttle-replay viewer: the bundled real clip with its
// analysis, or a video the user picks (browser-local blob URL). A picked video is analyzed
// automatically inside this browser (decode, models, court and trajectory in a worker; no
// upload) and the validated result is replayed. All file names and messages use textContent.

import { frameState, inImage, lookupFrame, parseAnalysisText, toAnalysisTime, validateAnalysis, toVideoTime, trailIndices } from "./analysis-model.js";
import { COURT } from "../assets/court-data.js";
import { FrameClock } from "./frame-clock.js";
import { containTransform, mapTrailRuns } from "./view-geometry.js";
import { PairLoader } from "./pair-loader.js";
import { plainCopy } from "./presentation.js";
import { ANKLES, PLAYER_COLORS, courtMarkerVisible, fitLabel, playerTrail, playersMapAvailable } from "./players.js";
import { BrowserAnalyzer } from "../browser/analyzer.mjs";
import { SHUTTLE_MAP_COLOR, shuttleEdgeArrow, shuttleLabelBox, shuttleRefLabel, shuttleRefTrail } from "./shuttle-map.js";

const SAMPLE_DIR = "assets/real/";
const OFFSET = 0; // analysis time = video time; the bundled pair starts at PTS 0
const COLORS = { observed: "#2fe36b", model: "#ff8a1f", line: "#e9efe9", net: "#ffffff" };
const PROBE_TIMEOUT_MS = 15000;
const NO_ANALYSIS = "선택한 영상, 분석 결과 없음";
const AUTO_DONE = "자동 분석 결과";
const STAGE_LABELS = {
  read: "영상 읽기", decode: "영상 디코딩", load_models: "모델 불러오기", models: "모델 불러오기", pose_frames: "선수 프레임 준비",
  shuttle: "셔틀 추적", tracknet: "셔틀 추적", physics_runtime: "물리 엔진 불러오기", trajectory: "궤적 추정",
  pose: "선수 검출", inference: "셔틀과 선수 검출", calibration_frames: "코트 프레임 준비", court: "코트 인식",
  calibration: "코트 인식", players: "선수 위치", flights: "궤적 추정", physics: "궤적 추정", export: "결과 정리", done: "결과 정리",
};
const BAND_LABELS = { decode: "영상 디코딩", models: "셔틀과 선수 검출", calibration: "코트 인식", physics: "궤적 추정" };

const $ = (id) => document.getElementById(id);
const el = {
  video: $("video"), overlay: $("cv-overlay"), court: $("cv-court"), videoMsg: $("video-msg"),
  range: $("rng-time"), play: $("btn-play"), inVideo: $("in-video"), inVideoFirst: $("in-video-first"), demo: $("btn-demo"),
  sample: $("btn-sample"), chooser: $("chooser"), sourceActions: $("source-actions"),
  sourceMsg: $("source-msg"), sourceState: $("source-state"), sourceName: $("source-name"), courtCue: $("court-cue"),
  stage: $("stage"), analyzing: $("analyzing"), analyzingLabel: $("analyzing-label"), analyzingProgress: $("analyzing-progress"),
  cancel: $("btn-cancel"),
};

const state = { model: null, meta: null, videoError: null, analyzing: false };

// ---------- loading ----------

function probeVideo(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "metadata";
    let timer = 0;
    const done = (fn, arg) => {
      clearTimeout(timer);
      v.onloadedmetadata = v.onerror = null;
      v.removeAttribute("src");
      v.load();
      fn(arg);
    };
    v.onloadedmetadata = () => {
      if (!v.videoWidth || !v.videoHeight) done(reject, new Error("영상 트랙이 없습니다."));
      else done(resolve, { width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    };
    v.onerror = () => done(reject, new Error("이 브라우저가 재생할 수 없는 영상입니다."));
    timer = setTimeout(() => done(reject, new Error("영상을 읽는 데 너무 오래 걸립니다.")), PROBE_TIMEOUT_MS);
    v.src = url;
  });
}

const loader = new PairLoader({
  readText: (file) => file.text(),
  parse: parseAnalysisText,
  probeVideo,
  createURL: (file) => URL.createObjectURL(file),
  revokeURL: (url) => URL.revokeObjectURL(url),
});

const analyzer = new BrowserAnalyzer();

function setSourceMsg(text, name = "", isError = false) {
  el.sourceState.textContent = text;
  el.sourceName.textContent = name;
  el.sourceName.title = name;
  el.sourceMsg.classList.toggle("error", isError);
}

async function loadSample() {
  const gen = loader.cancel(); // a reset supersedes any in-flight user selection
  analyzer.cancel();
  setAnalyzing(false);
  setSourceMsg("불러오는 중…");
  let text;
  try {
    const res = await fetch(SAMPLE_DIR + "analysis.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    if (gen !== loader.generation) return;
    setSourceMsg(`데모 분석을 읽지 못했습니다 (${String(e.message).slice(0, 60)}).`, "", true);
    return;
  }
  if (gen !== loader.generation) return; // a newer selection was made meanwhile
  const result = await loader.apply({ video: { url: SAMPLE_DIR + "source_clip.mp4" }, analysis: { text }, label: null });
  finishApply(result);
}

function stageLabel(p) {
  return STAGE_LABELS[p.stage] || BAND_LABELS[p.band] || "분석";
}

async function loadUserVideo(file) {
  analyzer.cancel(); // a new pick terminates the previous worker
  setAnalyzing(false);
  setSourceMsg("불러오는 중…", file.name);
  const result = await loader.apply({ video: { file }, analysis: null, label: file.name });
  if (result.status !== "committed") return finishApply(result);
  const gen = loader.generation;
  const isCurrent = () => gen === loader.generation;
  setAnalyzing(true);
  activate(result.pair); // the original video is visible (paused) under the overlay
  setSourceMsg("자동 분석 중…", file.name);
  const r = await analyzer.analyze(file, {
    onProgress: (p) => {
      if (!isCurrent()) return;
      const pct = Math.floor(100 * Math.max(0, Math.min(1, p.value)));
      const text = `${stageLabel(p)} ${pct}%`;
      el.analyzingLabel.textContent = text;
      el.analyzingProgress.value = pct;
    },
  });
  if (!isCurrent() || r.status === "cancelled") return;
  let model = null;
  let error = r.error && r.error.message;
  if (r.status === "done") {
    try {
      model = validateAnalysis(r.doc);
    } catch (e) {
      error = `분석 결과 검증 실패: ${e.message}`;
    }
  }
  const pair = model && loader.attachModel(gen, model);
  setAnalyzing(false);
  if (!pair) {
    // The original video stays playable; nothing from the failed job is shown.
    showCourtCue(null);
    setSourceMsg(`자동 분석 실패: ${String(error || "알 수 없는 오류").slice(0, 320)} 영상만 재생합니다.`, file.name, true);
    return;
  }
  activate(pair);
  el.stage.dataset.analysis = JSON.stringify(analysisSummary(model));
  el.video.play().catch(() => {});
}

/** Counts of what the attached analysis can draw (read by the browser smoke test). */
function analysisSummary(m) {
  let observed = 0, model = 0, players = 0, playersOnCourt = 0, mapRef = 0;
  const flights = new Set();
  for (const fr of m.frames) {
    if (fr.observed) observed++;
    if (fr.modelPx && fr.modelFlightId !== null) {
      model++;
      flights.add(fr.modelFlightId);
    }
    if (fr.players.length) players++;
    if (fr.players.some((p) => p.courtXy !== null)) playersOnCourt++;
    if (fr.shuttleMapRef) mapRef++;
  }
  return { frames: m.frames.length, observed, model, flights: flights.size, players, playersOnCourt, mapRef, calibration: m.playerCalibration.status };
}

/** Cancel from the overlay: the worker is terminated and the picked video stays playable. */
function cancelAnalysis() {
  if (!state.analyzing) return;
  analyzer.cancel();
  loader.cancel();
  setAnalyzing(false);
  showCourtCue(null);
  setSourceMsg("분석을 취소했습니다. 영상만 재생합니다.", (loader.active && loader.active.label) || "");
}

/**
 * Processing: one overlay covers both the video and the court, the stage is aria-busy, and
 * Play and the timeline stay disabled until the analyzed pair is active. Header actions
 * (replace video, demo) and the overlay's cancel stay usable.
 */
function setAnalyzing(on) {
  state.analyzing = on;
  if (on) delete el.stage.dataset.analysis;
  el.analyzing.hidden = !on;
  el.stage.setAttribute("aria-busy", on ? "true" : "false");
  if (on) {
    el.analyzingLabel.textContent = "자동 분석 준비 중";
    el.analyzingProgress.value = 0;
  }
  if (!el.chooser.hidden) return;
  el.play.disabled = el.range.disabled = on;
}

function finishApply(result) {
  if (result.status === "superseded") return;
  if (result.status === "failed") {
    setSourceMsg("이 영상을 열 수 없습니다. 현재 화면은 그대로입니다.", "", true);
    el.demo.hidden = !(loader.active && loader.active.owned);
    return;
  }
  activate(result.pair);
}

function activate(pair) {
  const v = el.video;
  clock.stop();
  v.pause();
  state.model = pair.model; // null for a user video: no bundled analysis is reused
  state.meta = pair.meta;
  state.videoError = null;
  v.src = pair.videoURL;
  v.load();
  setChosen(true);
  el.demo.hidden = !pair.owned;
  if (pair.owned) setSourceMsg(pair.model ? AUTO_DONE : NO_ANALYSIS, pair.label);
  else setSourceMsg("");
  showCourtCue(pair.model);
  setRange();
  layoutCanvases();
  render(toAnalysisTime(0, OFFSET));
}

/** Empty first screen (chooser) until a source is committed; header actions and transport after. */
function setChosen(on) {
  el.chooser.hidden = on;
  el.sourceActions.hidden = !on;
  el.play.disabled = el.range.disabled = !on || state.analyzing;
}

/** Back to the empty first screen (bfcache restore after dispose): nothing is loaded. */
function showEmpty() {
  clock.stop();
  setAnalyzing(false);
  state.model = state.meta = state.videoError = null;
  el.video.removeAttribute("src");
  el.video.load();
  el.courtCue.replaceChildren();
  setSourceMsg("");
  setChosen(false);
  layoutCanvases();
  render(0);
}

/** Compact cue only: the ≈ estimate when present, or a truthful empty state. */
function showCourtCue(m) {
  el.courtCue.replaceChildren();
  el.courtCue.dataset.kind = m ? "analysis" : "none";
  if (!m) {
    el.courtCue.textContent = state.analyzing ? "분석 중" : "분석 결과 없음";
  } else {
    // Automatic results: player floor cue and the conditional shuttle cue, side by side.
    const auto = m.playerCalibration.status === "automatic_reference";
    if (auto && playersMapAvailable(m)) el.courtCue.append("선수 위치 ≈ 자동 코트 기준");
    if (m.hasShuttleMapRef) {
      const key = document.createElement("span");
      key.className = "key key-shuttle-map";
      key.setAttribute("aria-hidden", "true");
      el.courtCue.append(key, auto ? "셔틀 ≈ 모델 추정" : "셔틀 위치 ≈ 추정");
    }
  }
}

function setRange() {
  const m = state.model;
  if (m) {
    el.range.min = String(m.pts[0]);
    el.range.max = String(m.pts[m.pts.length - 1]);
  } else {
    const d = Number.isFinite(el.video.duration) ? el.video.duration : state.meta && state.meta.duration;
    el.range.min = "0";
    el.range.max = String(Number.isFinite(d) && d > 0 ? d : 1);
  }
}

// ---------- time / rendering ----------

function currentAnalysisTime(videoTime = el.video.currentTime) {
  return toAnalysisTime(videoTime, OFFSET);
}

function render(analysisTime) {
  const m = state.model;
  let fr = null;
  let status = "before";
  if (m && !state.videoError) {
    const res = lookupFrame(m, analysisTime);
    status = res.status;
    fr = res.index >= 0 ? m.frames[res.index] : null;
  }
  drawOverlay(fr);
  drawCourt(fr);
  updateVideoMsg(m, fr, status);
  if (document.activeElement !== el.range) el.range.value = String(analysisTime);
}

/** Only a short message over the video: playback error or a camera cut. */
function updateVideoMsg(m, fr, status) {
  let msg = "";
  if (state.videoError) msg = state.videoError;
  else if (m && fr && frameState(m, fr.index, status).kind === "cut") msg = "카메라 컷";
  el.videoMsg.hidden = !msg;
  el.videoMsg.textContent = plainCopy(msg);
}

function fitCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.max(1, Math.round(cv.clientWidth * dpr));
  const h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  return dpr;
}

function layoutCanvases() {
  fitCanvas(el.overlay);
  fitCanvas(el.court);
}

function drawDot(ctx, x, y, r, fill, stroke) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r / 3);
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

// Observed = hollow green ring, model = filled orange dot: distinct even when they coincide.
function drawRing(ctx, x, y, r, color, stroke, dpr) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = 3.5 * dpr;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawPolyline(ctx, pts, color, width) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = ctx.lineCap = "round";
  ctx.stroke();
}

function drawOverlay(fr) {
  const cv = el.overlay;
  const dpr = fitCanvas(cv);
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  const m = state.model;
  if (!fr || !state.meta || fr.segmentKey === null) return;
  const { width: vw, height: vh } = state.meta;
  // Same contain rect as the <video> (object-fit: contain) for rings, dots and trails.
  const t = containTransform(vw, vh, cv.width, cv.height);
  drawPlayersOnVideo(ctx, fr, t, vw, vh, dpr, cv);
  const r = 4 * dpr;
  const layers = [
    ["model", true, (f) => f.modelPx, COLORS.model, "#4a2300"],
    ["observed", true, (f) => f.observed, COLORS.observed, "#0b3d1c"],
  ];
  for (const [kind, on, get, color, stroke] of layers) {
    if (!on) continue;
    {
      // Split at any out-of-image point so no segment is drawn through it.
      const pts = trailIndices(m, fr.index, kind, 15).map((i) => get(m.frames[i]));
      for (const run of mapTrailRuns(pts, t, vw, vh)) drawPolyline(ctx, run, color, 2 * dpr);
    }
    const p = get(fr);
    if (!p || !inImage(p, vw, vh)) continue;
    const [x, y] = t.map(p);
    if (kind === "observed") drawRing(ctx, x, y, r * 1.8, color, stroke, dpr);
    else if (fr.modelFlightId !== null) drawDot(ctx, x, y, r, color, stroke);
  }
}

// Player boxes, ankle markers and N1/N2/F1/F2 badges through the same contain transform.
function drawPlayersOnVideo(ctx, fr, t, vw, vh, dpr, cv) {
  const rect = { x: t.ox, y: t.oy, w: t.width, h: t.height };
  ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  for (const p of fr.players) {
    const color = PLAYER_COLORS[p.id];
    const x1 = Math.max(0, Math.min(vw, p.box[0]));
    const y1 = Math.max(0, Math.min(vh, p.box[1]));
    const x2 = Math.max(0, Math.min(vw, p.box[2]));
    const y2 = Math.max(0, Math.min(vh, p.box[3]));
    if (x2 <= x1 || y2 <= y1) continue; // box entirely outside the image: not drawn
    const [ax, ay] = t.map([x1, y1]);
    const [bx, by] = t.map([x2, y2]);
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.strokeRect(ax, ay, bx - ax, by - ay);
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = color;
    ctx.strokeRect(ax, ay, bx - ax, by - ay);
    if (p.keypoints) {
      for (const k of ANKLES) {
        const q = p.keypoints[k];
        if (q[2] < 0.3 || !inImage(q, vw, vh)) continue;
        const [qx, qy] = t.map(q);
        drawDot(ctx, qx, qy, 3 * dpr, color, "#10161a");
      }
    }
    const lw = ctx.measureText(p.short).width + 8 * dpr;
    const lh = 15 * dpr;
    const pos = fitLabel(ax, ay, lw, lh, rect, cv.width, cv.height);
    ctx.fillStyle = color;
    ctx.fillRect(pos.x, pos.y, lw, lh);
    ctx.fillStyle = "#10161a";
    ctx.fillText(p.short, pos.x + 4 * dpr, pos.y + 2 * dpr);
  }
  ctx.textBaseline = "alphabetic";
}

const COURT_MARGIN = { mx: 0.6, my: 0.9 };

function courtTransform(cv) {
  const { mx, my } = COURT_MARGIN;
  const s = Math.min(cv.width / (COURT.width_m + 2 * mx), cv.height / (COURT.length_m + 2 * my));
  const ox = (cv.width - COURT.width_m * s) / 2;
  const oy = (cv.height - COURT.length_m * s) / 2;
  return { s, map: (x, y) => [ox + x * s, oy + y * s] };
}

function drawCourt(fr) {
  const cv = el.court;
  const dpr = fitCanvas(cv);
  const ctx = cv.getContext("2d");
  const { s, map } = courtTransform(cv);
  ctx.fillStyle = "#0d2a1f";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#143a2b";
  const [ax, ay] = map(0, 0);
  ctx.fillRect(ax, ay, COURT.width_m * s, COURT.length_m * s);
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = Math.max(1, 0.04 * s);
  for (const [[x0, y0], [x1, y1]] of COURT.lines) {
    const a = map(x0, y0);
    const b = map(x1, y1);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  const n0 = map(-0.15, COURT.net_y_m);
  const n1 = map(COURT.width_m + 0.15, COURT.net_y_m);
  ctx.setLineDash([4 * dpr, 3 * dpr]);
  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = COLORS.net;
  ctx.beginPath();
  ctx.moveTo(n0[0], n0[1]);
  ctx.lineTo(n1[0], n1[1]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#b8c5bc";
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.fillText("네트", n1[0] - 30 * dpr, n1[1] - 4 * dpr);
  ctx.fillText("먼 쪽", 4 * dpr, 13 * dpr);
  ctx.fillText("카메라 쪽", 4 * dpr, cv.height - 5 * dpr);

  const m = state.model;
  // Players never depend on the shuttle model.
  drawPlayersOnCourt(ctx, fr, map, dpr);
  if (fr && m && fr.modelXyz !== null && fr.modelFlightId !== null) {
    {
      const pts = trailIndices(m, fr.index, "model", 40).map((i) => map(m.frames[i].modelXyz[0], m.frames[i].modelXyz[1]));
      drawPolyline(ctx, pts, COLORS.model, 2 * dpr);
    }
    const [x, y] = map(fr.modelXyz[0], fr.modelXyz[1]);
    drawDot(ctx, x, y, 5 * dpr, COLORS.model, "#4a2300");
    ctx.fillStyle = "#fff";
    ctx.fillText(`모델 z≈${fr.modelXyz[2].toFixed(2)} m (추정)`, Math.min(x + 8 * dpr, cv.width - 130 * dpr), y - 8 * dpr);
  }
  // Drawn last so the estimate stays visible over players.
  if (fr && m && fr.segmentKey !== null && fr.shuttleMapRef) drawShuttleMapRef(ctx, cv, fr, map, dpr);
}

const MAP_BOX = {
  x0: -COURT_MARGIN.mx, y0: -COURT_MARGIN.my, x1: COURT.width_m + COURT_MARGIN.mx, y1: COURT.length_m + COURT_MARGIN.my,
};

function strokeDiamond(ctx, x, y, r, dashed, dpr) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.setLineDash([]);
  ctx.lineWidth = 4.5 * dpr;
  ctx.strokeStyle = "rgba(16,22,26,0.85)";
  ctx.stroke();
  ctx.setLineDash(dashed ? [3 * dpr, 2.5 * dpr] : []);
  ctx.lineWidth = 2.5 * dpr;
  ctx.strokeStyle = SHUTTLE_MAP_COLOR;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawMapLabel(ctx, cv, text, x, y, r, dpr) {
  ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  const w = ctx.measureText(text).width + 8 * dpr;
  const h = 15 * dpr;
  const pos = shuttleLabelBox(x, y, w, h, r, cv.width, cv.height, 2 * dpr);
  ctx.fillStyle = "rgba(16,22,26,0.85)";
  ctx.fillRect(pos.x, pos.y, w, h);
  ctx.fillStyle = SHUTTLE_MAP_COLOR;
  ctx.fillText(text, pos.x + 4 * dpr, pos.y + 2 * dpr);
  ctx.textBaseline = "alphabetic";
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
}

// File-supplied conditional estimate only: hollow diamond, dashed when interpolated or held.
function drawShuttleMapRef(ctx, cv, fr, map, dpr) {
  const m = state.model;
  const ref = fr.shuttleMapRef;
  const arrow = shuttleEdgeArrow(ref.xy, MAP_BOX);
  {
    const pts = shuttleRefTrail(m, fr.index, 40);
    ctx.lineCap = ctx.lineJoin = "round";
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1];
      const b = pts[k];
      if (shuttleEdgeArrow(a.xy, MAP_BOX) || shuttleEdgeArrow(b.xy, MAP_BOX)) continue; // never drawn off the box
      const p = map(a.xy[0], a.xy[1]);
      const q = map(b.xy[0], b.xy[1]);
      ctx.setLineDash(a.dashed || b.dashed ? [4 * dpr, 3 * dpr] : []);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.strokeStyle = SHUTTLE_MAP_COLOR;
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  const r = 9 * dpr; // visibly larger than player dots (6 * dpr)
  if (arrow) {
    // Direction only, at the drawable edge; the value itself is not placed on the court.
    const [ex, ey] = map(arrow.x, arrow.y);
    const s = 9 * dpr;
    const cx = ex - Math.cos(arrow.angle) * s;
    const cy = ey - Math.sin(arrow.angle) * s;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(arrow.angle);
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.6, -s * 0.7);
    ctx.lineTo(-s * 0.6, s * 0.7);
    ctx.closePath();
    ctx.lineWidth = 4 * dpr;
    ctx.strokeStyle = "rgba(16,22,26,0.85)";
    ctx.stroke();
    ctx.setLineDash(ref.status === "estimated" ? [] : [3 * dpr, 2.5 * dpr]);
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = SHUTTLE_MAP_COLOR;
    ctx.stroke();
    ctx.restore();
    drawMapLabel(ctx, cv, shuttleRefLabel(ref, fr.pts, true), cx, cy, s, dpr);
    return;
  }
  const [x, y] = map(ref.xy[0], ref.xy[1]);
  strokeDiamond(ctx, x, y, r, ref.status !== "estimated", dpr);
  drawMapLabel(ctx, cv, shuttleRefLabel(ref, fr.pts), x, y, r, dpr);
}

// Manual-reference floor positions (≈) only where the file supplies court_xy_m.
function drawPlayersOnCourt(ctx, fr, map, dpr) {
  const m = state.model;
  if (fr && m && fr.segmentKey !== null) {
    for (const p of fr.players) {
      if (p.courtXy === null) continue;
      if (!courtMarkerVisible(p.courtXy, COURT_MARGIN.mx, COURT_MARGIN.my, COURT.width_m, COURT.length_m)) {
        continue;
      }
      const color = PLAYER_COLORS[p.id];
      {
        // Split where a trail point leaves the drawable margin; never clipped into the court.
        let run = [];
        for (const i of playerTrail(m, fr.index, p.id, 40)) {
          const q = m.frames[i].players.find((x) => x.id === p.id).courtXy;
          if (courtMarkerVisible(q, COURT_MARGIN.mx, COURT_MARGIN.my, COURT.width_m, COURT.length_m)) run.push(map(q[0], q[1]));
          else {
            drawPolyline(ctx, run, color, 1.5 * dpr);
            run = [];
          }
        }
        drawPolyline(ctx, run, color, 1.5 * dpr);
      }
      const [x, y] = map(p.courtXy[0], p.courtXy[1]);
      drawDot(ctx, x, y, 6 * dpr, color, "#10161a");
      ctx.fillStyle = "#10161a";
      ctx.font = `700 ${8 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.short, x, y);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }
  }
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
}

// ---------- controls ----------

function seekTo(t) {
  if (!state.meta) return;
  const dur = el.video.duration;
  const vt = Math.max(0, toVideoTime(t, OFFSET));
  el.video.currentTime = Number.isFinite(dur) ? Math.min(vt, dur) : vt;
  render(currentAnalysisTime(el.video.currentTime));
}

const clock = new FrameClock(el.video, (mediaTime) => render(currentAnalysisTime(mediaTime)));

el.play.addEventListener("click", () => {
  if (!state.meta || state.analyzing) return;
  if (el.video.paused || el.video.ended) el.video.play().catch(() => {});
  else el.video.pause();
});
el.video.addEventListener("play", () => {
  el.play.textContent = "일시정지";
  clock.start();
});
for (const ev of ["pause", "ended"]) {
  el.video.addEventListener(ev, () => {
    el.play.textContent = "재생";
    clock.stop();
    render(currentAnalysisTime());
  });
}
el.video.addEventListener("seeked", () => render(currentAnalysisTime()));
el.video.addEventListener("loadeddata", () => render(currentAnalysisTime()));
// Keep the contain transform on the element's own decoded size.
el.video.addEventListener("loadedmetadata", () => {
  const v = el.video;
  if (!state.meta || !v.videoWidth || !v.videoHeight) return;
  state.meta = { ...state.meta, width: v.videoWidth, height: v.videoHeight, duration: v.duration };
  setRange();
  layoutCanvases();
  render(currentAnalysisTime());
});
el.video.addEventListener("error", () => {
  const active = loader.active;
  // Ignore errors from a source that is no longer the active one.
  if (!el.video.getAttribute("src") || !active || el.video.src !== new URL(active.videoURL, document.baseURI).href) return;
  clock.stop();
  state.videoError = "영상을 재생할 수 없습니다.";
  setSourceMsg("영상을 재생할 수 없습니다. 다른 영상을 고르세요.", "", true);
  render(currentAnalysisTime());
});
el.range.addEventListener("input", () => seekTo(Number(el.range.value)));

for (const input of [el.inVideo, el.inVideoFirst]) {
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    input.value = ""; // the same file can be picked again
    if (!file) return; // picker cancelled: keep what is shown
    loadUserVideo(file);
  });
}
el.demo.addEventListener("click", () => loadSample());
el.cancel.addEventListener("click", () => cancelAnalysis());
el.sample.addEventListener("click", () => loadSample());

document.addEventListener("keydown", (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON" || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === " ") {
    e.preventDefault();
    el.play.click();
  }
});

let resizeRaf = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    layoutCanvases();
    render(currentAnalysisTime());
  });
});
window.addEventListener("pagehide", () => {
  clock.stop();
  analyzer.cancel();
  loader.dispose();
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted && !loader.active) showEmpty(); // restored from bfcache after dispose
});

el.video.muted = true;
showEmpty(); // nothing is fetched or attached until the viewer chooses a source
