// SPDX-License-Identifier: AGPL-3.0-only
// Pure, DOM-free player helpers: stable identities, counts, court trails and label fitting.
// Court positions come only from the file's per-frame court_xy_m under a validated manual
// or automatic reference calibration; nothing here invents, holds or interpolates a position.

export const PLAYER_IDS = Object.freeze(["near-left", "near-right", "far-left", "far-right"]);
/** Singles identities (automatic local analysis): one player per court half. */
export const SINGLES_PLAYER_IDS = Object.freeze(["near", "far"]);
export const PLAYER_SHORT = Object.freeze({ "near-left": "N1", "near-right": "N2", "far-left": "F1", "far-right": "F2", near: "N", far: "F" });
export const PLAYER_COLORS = Object.freeze({
  "near-left": "#4fc3f7",
  "near-right": "#c58cff",
  "far-left": "#ffd84d",
  "far-right": "#ff6f9c",
  near: "#4fc3f7",
  far: "#ffd84d",
});
/** COCO-17 ankle keypoint indices (left, right). */
export const ANKLES = Object.freeze([15, 16]);

/** Detected players and how many carry a manual-reference floor position. */
export function playerCounts(fr) {
  const ps = fr && Array.isArray(fr.players) ? fr.players : [];
  return { detected: ps.length, mapped: ps.filter((p) => p.courtXy !== null).length };
}

/** Status-line text; null when the file carries no player data at all (old files). */
export function playerReadout(model, fr) {
  if (!model || !model.hasPlayers) return null;
  const { detected, mapped } = playerCounts(fr);
  return `선수 ${detected}명 검출, 바닥 위치 ${mapped}명`;
}

/** True when at least one frame has a drawable floor position. */
export function playersMapAvailable(model) {
  if (!model || !model.playerCalibration || !model.playerCalibration.permitsProjection) return false;
  return model.frames.some((fr) => fr.players.some((p) => p.courtXy !== null));
}

/** Court caption from what the data can draw. Shuttle is never projected through the floor reference. */
export function courtCaption(modelAvailable, playersMapped) {
  const shuttle = modelAvailable
    ? "채택된 비행의 조건부 모델 위치를 그립니다. 높이와 속도는 추정입니다."
    : "현재는 2D 관측 후보 확인용입니다. 3D 보정과 비행 모델이 없습니다.";
  if (!playersMapped) return shuttle;
  return modelAvailable
    ? `${shuttle} 선수 바닥 위치 ≈ 수동 코트 보정 기준입니다.`
    : "선수 바닥 위치 ≈ 수동 코트 보정 기준입니다. 셔틀 3D 모델은 없습니다.";
}

/** Marker drawable inside the court canvas margin (metres); outside ones are omitted, never clipped. */
export function courtMarkerVisible(xy, mx, my, widthM = 6.1, lengthM = 13.4) {
  return xy[0] >= -mx && xy[0] <= widthM + mx && xy[1] >= -my && xy[1] <= lengthM + my;
}

function hasCourt(fr, id) {
  if (fr.segmentKey === null) return null;
  const p = fr.players.find((q) => q.id === id);
  return p && p.courtXy !== null ? p : null;
}

/**
 * Trail of frame indices ending at `index` for one player identity: consecutive frame ids
 * in the same segment, each with a floor position. Breaks on null, missing, cut or segment change.
 */
export function playerTrail(model, index, id, maxLen = 40) {
  const out = [];
  if (index < 0 || index >= model.frames.length) return out;
  let cur = model.frames[index];
  if (!hasCourt(cur, id)) return out;
  out.push(index);
  for (let i = index - 1; i >= 0 && out.length < maxLen; i--) {
    const prev = model.frames[i];
    if (!hasCourt(prev, id) || prev.segmentKey !== cur.segmentKey || cur.frameId - prev.frameId !== 1) break;
    out.push(i);
    cur = prev;
  }
  return out.reverse();
}

/**
 * Top-left for a w x h label anchored at a box corner (bx, by): prefers just above the box,
 * then clamps inside the content rect ∩ canvas so it is never cut off.
 */
export function fitLabel(bx, by, w, h, rect, cw, ch) {
  const x0 = Math.max(rect.x, 0);
  const y0 = Math.max(rect.y, 0);
  const x1 = Math.min(rect.x + rect.w, cw) - w;
  const y1 = Math.min(rect.y + rect.h, ch) - h;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  let y = by - h;
  if (y < y0) y = by; // no room above: sit just inside the box top
  return { x: clamp(bx, x0, x1), y: clamp(y, y0, y1) };
}
