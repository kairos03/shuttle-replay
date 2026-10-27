// SPDX-License-Identifier: AGPL-3.0-only
// DOM wiring for the shuttle-replay static viewer. All file and JSON text is
// rendered with textContent only.

import {
  durationMismatch,
  firstFrameAtOrAfter,
  frameState,
  inImage,
  lookupFrame,
  outOfBoundsCount,
  parseAnalysisText,
  seekTimeForIndex,
  stepIndex,
  toAnalysisTime,
  toVideoTime,
  trailIndices,
} from "./analysis-model.js";
import { COURT } from "../assets/court-data.js";
import { FrameClock } from "./frame-clock.js";
import { PairLoader } from "./pair-loader.js";

const SAMPLE_DIR = "assets/sample/";
const COLORS = { observed: "#2fe36b", model: "#ff8a1f", line: "#e9efe9", net: "#ffffff" };
const PROBE_TIMEOUT_MS = 15000;

const $ = (id) => document.getElementById(id);
const el = {
  video: $("video"), overlay: $("cv-overlay"), court: $("cv-court"), strip: $("cv-strip"),
  videoBox: $("video-box"), videoMsg: $("video-msg"), range: $("rng-time"),
  play: $("btn-play"), prev: $("btn-prev"), next: $("btn-next"), speed: $("sel-speed"),
  sound: $("btn-sound"), tgObserved: $("tg-observed"), tgModel: $("tg-model"), tgTrail: $("tg-trail"),
  roTime: $("ro-time"), roFrame: $("ro-frame"), roSeg: $("ro-seg"), roFlight: $("ro-flight"),
  roZ: $("ro-z"), roState: $("ro-state"), flightList: $("flight-list"), flightEmpty: $("flight-empty"),
  inVideo: $("in-video"), inAnalysis: $("in-analysis"), inOffset: $("in-offset"),
  apply: $("btn-apply"), sample: $("btn-sample"), fileMsg: $("file-msg"), badge: $("data-badge"),
};

const state = {
  model: null, meta: null, offset: 0, index: -1, lookup: "before",
  videoError: null, warning: null, renderedFlight: null,
};

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
      if (!v.videoWidth || !v.videoHeight) {
        done(reject, new Error("영상 트랙이 없거나 크기를 알 수 없습니다."));
      } else {
        done(resolve, { width: v.videoWidth, height: v.videoHeight, duration: v.duration });
      }
    };
    v.onerror = () => done(reject, new Error("이 브라우저가 재생할 수 없는 영상 형식입니다 (H.264 MP4 또는 VP9 WebM 권장)."));
    timer = setTimeout(() => done(reject, new Error("영상 메타데이터를 읽는 데 시간이 너무 오래 걸립니다.")), PROBE_TIMEOUT_MS);
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

function sampleVideoURL() {
  const probe = document.createElement("video");
  if (probe.canPlayType('video/mp4; codecs="avc1.42E01E"')) return SAMPLE_DIR + "synthetic_rally.mp4";
  return SAMPLE_DIR + "synthetic_rally.webm";
}

function setFileMsg(text, isError = false) {
  el.fileMsg.textContent = text;
  el.fileMsg.classList.toggle("error", isError);
}

async function loadSample() {
  setFileMsg("샘플 불러오는 중…");
  let text;
  const gen = loader.generation;
  try {
    const res = await fetch(SAMPLE_DIR + "analysis.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    if (gen !== loader.generation) return;
    setFileMsg(`샘플 분석 파일을 읽지 못했습니다 (${String(e.message).slice(0, 80)}). 로컬 웹 서버로 열어 주세요 (README 참고).`, true);
    return;
  }
  if (gen !== loader.generation) return; // a newer local selection was applied meanwhile
  const result = await loader.apply({ video: { url: sampleVideoURL() }, analysis: { text }, label: null });
  finishApply(result, 0, true);
}

async function applyLocal() {
  const vf = el.inVideo.files && el.inVideo.files[0];
  const af = el.inAnalysis.files && el.inAnalysis.files[0];
  if (!vf || !af) return;
  const offset = Number(el.inOffset.value);
  if (!Number.isFinite(offset) || Math.abs(offset) > 86400) {
    setFileMsg("시간 오프셋이 올바른 숫자가 아닙니다.", true);
    return;
  }
  setFileMsg("파일 검사 중…");
  const result = await loader.apply({ video: { file: vf }, analysis: { file: af }, label: vf.name });
  finishApply(result, offset, false);
}

function finishApply(result, offset, isSample) {
  if (result.status === "superseded") return;
  if (result.status === "failed") {
    const msg = result.error && result.error.message ? result.error.message : String(result.error);
    setFileMsg(`적용하지 못했습니다: ${msg} 현재 표시 중인 데이터는 그대로입니다.`, true);
    return;
  }
  activate(result.pair, offset, isSample);
}

function activate(pair, offset, isSample) {
  const v = el.video;
  clock.stop();
  v.pause();
  state.model = pair.model;
  state.meta = pair.meta;
  state.offset = offset;
  state.videoError = null;
  state.index = -1;
  state.renderedFlight = null;
  v.src = pair.videoURL;
  v.load();
  v.playbackRate = Number(el.speed.value);
  el.inOffset.value = String(offset);
  el.videoBox.style.aspectRatio = `${pair.meta.width} / ${pair.meta.height}`;

  const warnings = [];
  const oob = outOfBoundsCount(pair.model, pair.meta.width, pair.meta.height);
  if (oob > 0) warnings.push(`영상 크기(${pair.meta.width}×${pair.meta.height}) 밖의 점 ${oob}개는 그리지 않습니다.`);
  const mm = durationMismatch(pair.model, pair.meta.duration, offset);
  if (mm) warnings.push(mm);
  if (!isSample && pair.label && pair.model.sourceVideo && pair.model.sourceVideo !== pair.label) {
    warnings.push(`분석의 source_video(${pair.model.sourceVideo})와 선택한 영상 이름(${pair.label})이 다릅니다.`);
  }
  state.warning = warnings.join(" ") || null;

  const synthetic = pair.model.synthetic;
  el.badge.textContent = isSample ? "합성 샘플" : synthetic ? "로컬 파일 · 합성 데이터" : "로컬 파일";
  el.badge.classList.toggle("local", !isSample);
  setFileMsg(isSample ? "합성 샘플을 표시 중입니다." : `적용됨: ${pair.label}`);
  if (state.warning) setFileMsg(`${el.fileMsg.textContent} ${state.warning}`);

  const m = pair.model;
  el.range.min = String(m.pts[0]);
  el.range.max = String(m.pts[m.pts.length - 1]);
  el.range.value = String(m.pts[0]);
  buildFlightList(m);
  layoutCanvases();
  drawStrip();
  render(toAnalysisTime(0, offset));
}

// ---------- time / rendering ----------

function currentAnalysisTime(videoTime = el.video.currentTime) {
  return toAnalysisTime(videoTime, state.offset);
}

function render(analysisTime) {
  const m = state.model;
  if (!m) return;
  const res = state.videoError ? { index: -1, status: "after" } : lookupFrame(m, analysisTime);
  state.index = res.index;
  state.lookup = res.status;
  const fr = res.index >= 0 ? m.frames[res.index] : null;
  drawOverlay(fr);
  drawCourt(fr);
  updateReadout(analysisTime, fr, res.status);
  if (document.activeElement !== el.range) el.range.value = String(analysisTime);
  drawStripCursor(analysisTime);
}

function updateReadout(t, fr, status) {
  const m = state.model;
  el.roTime.textContent = `${t.toFixed(3)} s`;
  if (!fr) {
    el.roFrame.textContent = el.roSeg.textContent = el.roFlight.textContent = el.roZ.textContent = "–";
  } else {
    el.roFrame.textContent = `#${fr.frameId} (${fr.index + 1}/${m.frames.length}) · pts ${fr.pts.toFixed(4)}`;
    el.roSeg.textContent = fr.segmentKey === null ? "없음 (컷)" : segLabel(m, fr.segmentKey);
    const fi = m.flightOfFrame[fr.index];
    el.roFlight.textContent = fi >= 0 ? m.flights[fi].id : "–";
    el.roZ.textContent = fr.modelXyz ? `≈ ${fr.modelXyz[2].toFixed(2)} m` : "–";
  }
  let st;
  if (state.videoError) st = { kind: "error", label: state.videoError };
  else st = frameState(m, fr ? fr.index : -1, status);
  el.roState.textContent = st.label;
  el.roState.dataset.kind = st.kind;
  el.videoMsg.hidden = !(st.kind === "cut" || st.kind === "outside" || st.kind === "error");
  el.videoMsg.textContent = st.label;
  highlightFlight(fr ? m.flightOfFrame[fr.index] : -1);
}

function segLabel(m, key) {
  const s = m.segments.get(key);
  return s ? String(s.id) : "?";
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
  fitCanvas(el.strip);
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
  const sx = cv.width / vw;
  const sy = cv.height / vh;
  const r = 4 * dpr;
  const layers = [
    ["model", el.tgModel.checked, (f) => f.modelPx, COLORS.model, "#4a2300"],
    ["observed", el.tgObserved.checked, (f) => f.observed, COLORS.observed, "#0b3d1c"],
  ];
  for (const [kind, on, get, color, stroke] of layers) {
    if (!on) continue;
    if (el.tgTrail.checked) {
      // Split at any out-of-image point so no segment is drawn through it.
      let run = [];
      for (const i of trailIndices(m, fr.index, kind, 15)) {
        const p = get(m.frames[i]);
        if (!inImage(p, vw, vh)) {
          drawPolyline(ctx, run, color, 2 * dpr);
          run = [];
          continue;
        }
        run.push([p[0] * sx, p[1] * sy]);
      }
      drawPolyline(ctx, run, color, 2 * dpr);
    }
    const p = get(fr);
    if (!p || !inImage(p, vw, vh)) continue;
    if (kind === "observed") drawRing(ctx, p[0] * sx, p[1] * sy, r * 1.8, color, stroke, dpr);
    else if (fr.modelFlightId !== null) drawDot(ctx, p[0] * sx, p[1] * sy, r, color, stroke);
  }
}

function courtTransform(cv) {
  const mx = 0.6;
  const my = 0.9;
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
  if (!fr || !m || !el.tgModel.checked || fr.modelXyz === null || fr.modelFlightId === null) return;
  if (el.tgTrail.checked) {
    const pts = trailIndices(m, fr.index, "model", 40).map((i) => map(m.frames[i].modelXyz[0], m.frames[i].modelXyz[1]));
    drawPolyline(ctx, pts, COLORS.model, 2 * dpr);
  }
  const [x, y] = map(fr.modelXyz[0], fr.modelXyz[1]);
  drawDot(ctx, x, y, 5 * dpr, COLORS.model, "#4a2300");
  ctx.fillStyle = "#fff";
  ctx.fillText(`모델 z≈${fr.modelXyz[2].toFixed(2)} m (추정)`, Math.min(x + 8 * dpr, cv.width - 130 * dpr), y - 8 * dpr);
}

function drawStrip() {
  const cv = el.strip;
  fitCanvas(cv);
  const ctx = cv.getContext("2d");
  const m = state.model;
  ctx.fillStyle = "#cfc7b6";
  ctx.fillRect(0, 0, cv.width, cv.height);
  if (!m) return;
  const t0 = m.pts[0];
  const span = Math.max(1e-6, m.pts[m.pts.length - 1] - t0);
  const X = (t) => ((t - t0) / span) * cv.width;
  for (const sgm of m.segments.values()) {
    ctx.fillStyle = "#2d5a45";
    ctx.fillRect(X(sgm.startS), 0, Math.max(1, X(sgm.endS) - X(sgm.startS)), cv.height);
  }
  for (const f of m.flights) {
    ctx.fillStyle = f.accepted ? COLORS.model : "#8a8579";
    ctx.fillRect(X(f.t0) - 1, 0, 2, cv.height);
  }
  stripBase = ctx.getImageData(0, 0, cv.width, cv.height);
}
let stripBase = null;

function drawStripCursor(t) {
  const cv = el.strip;
  const m = state.model;
  if (!m || !stripBase || stripBase.width !== cv.width) return drawStrip();
  const ctx = cv.getContext("2d");
  ctx.putImageData(stripBase, 0, 0);
  const span = Math.max(1e-6, m.pts[m.pts.length - 1] - m.pts[0]);
  const x = ((t - m.pts[0]) / span) * cv.width;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(Math.round(x) - 1, 0, 3, cv.height);
}

// ---------- flight list ----------

const END_LABEL = {
  intercepted_by_next_contact: "다음 접촉에서 끝남",
  landing_region: "검토된 착지 영역",
  open_segment_end: "세그먼트 끝까지 (열림)",
};
const STATUS_LABEL = {
  accepted: "채택",
  rejected_by_gates_or_fit: "기각 — 물리 게이트/적합 실패",
  insufficient_observations: "기각 — 관측 부족",
};

function buildFlightList(m) {
  el.flightList.replaceChildren();
  el.flightEmpty.hidden = m.flights.length > 0;
  const sorted = m.flights.map((f, i) => [f, i]).sort((a, b) => a[0].t0 - b[0].t0);
  for (const [f, i] of sorted) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.flight = String(i);
    if (!f.accepted) b.classList.add("rejected");
    const title = document.createElement("span");
    title.className = "f-title";
    title.textContent = `${f.id} · ${STATUS_LABEL[f.status] || (f.accepted ? "채택" : `기각 (${f.status})`)}`;
    const meta = document.createElement("span");
    meta.className = "f-meta";
    const parts = [
      `세그먼트 ${segLabel(m, f.segmentKey)}`,
      `t0 ${f.t0.toFixed(3)} s (사람 검토)`,
      END_LABEL[f.endType] || f.endType,
    ];
    if (f.accepted && f.speedCoarseKmH !== null) parts.push(`모델 초기 속도 ≈${f.speedCoarseKmH} km/h (추정)`);
    if (!f.accepted) parts.push("모델 미표시");
    meta.textContent = parts.join(" · ");
    b.append(title, meta);
    b.addEventListener("click", () => {
      el.video.pause();
      const idx = firstFrameAtOrAfter(m, f.t0);
      if (idx < 0) return;
      seekAnalysis(seekTimeForIndex(m, idx), `${f.id}: t0 이후 첫 프레임으로 이동`);
    });
    li.append(b);
    el.flightList.append(li);
  }
}

function highlightFlight(fi) {
  if (state.renderedFlight === fi) return;
  state.renderedFlight = fi;
  for (const b of el.flightList.querySelectorAll("button")) {
    if (Number(b.dataset.flight) === fi) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  }
}

// ---------- controls ----------

function seekAnalysis(t, note) {
  const m = state.model;
  if (!m) return;
  const vt = toVideoTime(t, state.offset);
  const dur = el.video.duration;
  if (vt < 0 || (Number.isFinite(dur) && vt > dur)) {
    el.roState.textContent = "이 시각은 영상 범위 밖입니다 (오프셋 확인).";
    el.roState.dataset.kind = "outside";
    return;
  }
  el.video.currentTime = vt;
  render(t);
  if (note) el.roState.textContent = `${note} — ${el.roState.textContent}`;
}

function step(delta) {
  const m = state.model;
  if (!m) return;
  el.video.pause();
  const base = state.index >= 0 ? state.index : lookupFrame(m, currentAnalysisTime()).index;
  let idx;
  if (base < 0) idx = state.lookup === "after" ? m.frames.length - 1 : 0;
  else idx = stepIndex(m, base, delta);
  seekAnalysis(seekTimeForIndex(m, idx));
}

const clock = new FrameClock(el.video, (mediaTime) => render(currentAnalysisTime(mediaTime)));

el.play.addEventListener("click", () => {
  if (!state.model) return;
  if (el.video.paused || el.video.ended) el.video.play().catch((e) => setFileMsg(`재생 실패: ${e.message}`, true));
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
el.video.addEventListener("error", () => {
  if (!el.video.getAttribute("src")) return;
  clock.stop();
  state.videoError = "영상을 재생할 수 없습니다. 오버레이를 숨겼습니다. ‘샘플로 복구’를 누르거나 다른 파일을 고르세요.";
  render(currentAnalysisTime());
});
el.prev.addEventListener("click", () => step(-1));
el.next.addEventListener("click", () => step(1));
el.speed.addEventListener("change", () => {
  el.video.playbackRate = Number(el.speed.value);
});
el.sound.addEventListener("click", () => {
  el.video.muted = !el.video.muted;
  el.sound.setAttribute("aria-pressed", String(!el.video.muted));
  el.sound.textContent = el.video.muted ? "소리 꺼짐" : "소리 켜짐 (테스트 톤)";
});
el.range.addEventListener("input", () => seekAnalysis(Number(el.range.value)));
for (const t of [el.tgObserved, el.tgModel, el.tgTrail]) {
  t.addEventListener("change", () => render(currentAnalysisTime()));
}
const updateApply = () => {
  el.apply.disabled = !(el.inVideo.files && el.inVideo.files.length && el.inAnalysis.files && el.inAnalysis.files.length);
  if (!el.apply.disabled) setFileMsg("두 파일을 골랐습니다. ‘이 쌍 적용’을 누르면 검사 후 바꿉니다.");
};
el.inVideo.addEventListener("change", updateApply);
el.inAnalysis.addEventListener("change", updateApply);
el.apply.addEventListener("click", applyLocal);
el.sample.addEventListener("click", () => {
  el.inVideo.value = el.inAnalysis.value = "";
  el.apply.disabled = true;
  loadSample();
});
el.inOffset.addEventListener("change", () => {
  const v = Number(el.inOffset.value);
  if (!state.model || !Number.isFinite(v) || Math.abs(v) > 86400) return;
  state.offset = v;
  render(currentAnalysisTime());
});

document.addEventListener("keydown", (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    step(-1);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    step(1);
  } else if (e.key === " " && tag !== "BUTTON") {
    e.preventDefault();
    el.play.click();
  }
});

let resizeRaf = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    layoutCanvases();
    drawStrip();
    render(currentAnalysisTime());
  });
});
window.addEventListener("pagehide", () => {
  clock.stop();
  loader.dispose();
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted && !loader.active) loadSample(); // restored from bfcache after dispose
});

el.video.muted = true;
drawStrip();
loadSample();
