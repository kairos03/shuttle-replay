// SPDX-License-Identifier: AGPL-3.0-only
// Presentation-only helpers: visible copy and control availability derived from the
// validated model. They never change analysis facts.

/** Visible copy never shows a middle dot; joins become commas. */
export const plainCopy = (s) => String(s).replace(/\s*·\s*/g, ", ");

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
