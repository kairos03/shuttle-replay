// SPDX-License-Identifier: AGPL-3.0-only
// Presentation-only helpers: visible copy and control availability derived from the
// validated model. They never change analysis facts.

/** Visible copy never shows a middle dot; joins become commas. */
export const plainCopy = (s) => String(s).replace(/\s*·\s*/g, ", ");

/** Playback clock text, m:ss.ss (e.g. "0:03.47"); "0:00.00" for a missing or negative time. */
export function formatClock(t) {
  const cs = Number.isFinite(t) && t > 0 ? Math.round(t * 100) : 0;
  const m = Math.floor(cs / 6000);
  const s = ((cs % 6000) / 100).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

/** Shortest repeat span: shorter ones would seek back on every frame and look frozen. */
export const MIN_LOOP_S = 0.1;

/**
 * A-B repeat, one button: off (null) -> start marked {a} -> repeating {a, b} -> off.
 * The end mark may come before the start; the pair is kept in time order. An end mark
 * closer than MIN_LOOP_S to the start changes nothing.
 */
export function nextLoop(loop, t) {
  if (!loop) return { a: t, b: null };
  if (loop.b !== null) return null;
  if (Math.abs(t - loop.a) < MIN_LOOP_S) return loop;
  return t > loop.a ? { a: loop.a, b: t } : { a: t, b: loop.a };
}

/** Where playback jumps back to once it reaches the end mark, or null to keep playing. */
export function loopWrapTarget(loop, t) {
  return loop && loop.b !== null && t >= loop.b ? loop.a : null;
}

/** Repeat button text for each state. */
export function loopButtonText(loop) {
  if (!loop) return "구간 반복";
  return loop.b === null ? "끝 지점 찍기" : "반복 해제";
}

/** Accessible name: the visible text plus the marked times, which the bar alone cannot say. */
export function loopLabel(loop) {
  if (!loop) return "구간 반복: 지금 위치를 시작 지점으로 찍기";
  if (loop.b === null) return `구간 반복: 시작 ${formatClock(loop.a)}, 지금 위치를 끝 지점으로 찍기`;
  return `구간 반복 중 ${formatClock(loop.a)}부터 ${formatClock(loop.b)}까지, 누르면 해제`;
}

/**
 * True when the loaded model has at least one frame the renderer would draw as a model
 * point (same test as trailIndices/hasPoint "model": modelPx and modelFlightId set).
 * validateAnalysis only allows model points inside accepted flights.
 */
export function modelAvailable(model) {
  if (!model || !Array.isArray(model.frames)) return false;
  return model.frames.some((fr) => fr.modelPx !== null && fr.modelFlightId !== null);
}

/** One scope sentence for the court caption, from what the loaded data can draw. */
export function scopeStatement(available) {
  return available
    ? "채택된 비행의 조건부 모델 위치를 그립니다. 높이와 속도는 추정입니다."
    : "현재는 2D 관측 후보 확인용입니다. 3D 보정과 비행 모델이 없습니다.";
}

/** Short reason shown beside the disabled model toggle. */
export function modelToggleNote(available) {
  return available ? "" : "이 데이터에는 채택된 모델이 없어 켤 수 없습니다.";
}

/**
 * Human-readable primary readout for the current frame.
 * kind mirrors frameState kinds plus "error"; obs says only whether a 2D observation
 * candidate exists at this frame, never whether it is correct.
 */
export function primaryReadout(model, fr, lookupStatus, videoError, t) {
  const time = `${Number(t).toFixed(3)}초`;
  if (videoError) return { kind: "error", now: time, obs: plainCopy(videoError) };
  if (lookupStatus === "before" || lookupStatus === "after" || !fr) {
    return { kind: "outside", now: time, obs: "분석 범위 밖, 표시할 점 없음" };
  }
  const now = `프레임 ${fr.index + 1}/${model.frames.length}, ${time}`;
  if (fr.layer === "excluded_camera_cut") return { kind: "cut", now, obs: "카메라 컷 구간, 표시할 점 없음" };
  const parts = [fr.observed !== null ? "2D 관측 후보 있음" : "2D 관측 후보 없음"];
  if (fr.modelPx !== null && fr.modelFlightId !== null) parts.push("조건부 모델 있음");
  return { kind: fr.observed !== null ? "observed" : "gap", now, obs: parts.join(", ") };
}

/** Readout for a seek target outside the video's own range (offset problem). */
export const outsideVideoReadout = (t) => ({
  kind: "outside", now: `${Number(t).toFixed(3)}초`, obs: "영상 범위 밖, 오프셋 확인 필요",
});
