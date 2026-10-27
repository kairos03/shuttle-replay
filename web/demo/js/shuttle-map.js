// SPDX-License-Identifier: AGPL-3.0-only
// Pure, DOM-free helpers for the display-only shuttle map reference (≈). Positions come only
// from the file's validated per-frame shuttle_map_reference; nothing here computes, clamps,
// holds or interpolates a substitute coordinate. Every status is a conditional estimate.

import { courtCaption } from "./players.js";

/** Hollow yellow diamond; distinct from the F1 player colour (#ffd84d). */
export const SHUTTLE_MAP_COLOR = "#fff16a";

const TRAIL_STATUS = new Set(["estimated", "interpolated"]);

function trailRef(fr) {
  if (!fr || fr.segmentKey === null) return null;
  const r = fr.shuttleMapRef;
  return r && TRAIL_STATUS.has(r.status) ? r : null;
}

/**
 * Trail ending at `index`: up to maxLen consecutive frame ids in one segment with estimated or
 * interpolated refs of the same flight id. Empty during a reference hold, a cut or an absent
 * ref, so a held point never connects to later estimates. Interpolated points are dashed.
 */
export function shuttleRefTrail(model, index, maxLen = 40) {
  const out = [];
  if (!model || index < 0 || index >= model.frames.length) return out;
  let cur = model.frames[index];
  const first = trailRef(cur);
  if (!first) return out;
  out.push({ index, xy: first.xy, dashed: first.status === "interpolated" });
  for (let i = index - 1; i >= 0 && out.length < maxLen; i--) {
    const prev = model.frames[i];
    const r = trailRef(prev);
    if (!r || prev.segmentKey !== cur.segmentKey || cur.frameId - prev.frameId !== 1) break;
    if (r.flightId !== cur.shuttleMapRef.flightId) break;
    out.push({ index: i, xy: r.xy, dashed: r.status === "interpolated" });
    cur = prev;
  }
  return out.reverse();
}

/** Fixed marker label; a reference hold shows how far its original seed time is. */
export function shuttleRefLabel(ref, pts, offCourt = false) {
  if (offCourt) return "셔틀 ≈ 범위 밖";
  if (ref.status === "interpolated") return "셔틀 ≈ 보간";
  if (ref.status !== "reference") return "셔틀 ≈";
  if (!Number.isFinite(ref.referencePts) || !Number.isFinite(pts)) return "셔틀 ≈ 참조";
  const age = pts - ref.referencePts;
  return `셔틀 ≈ 참조 ${Math.abs(age).toFixed(2)}초 ${age >= 0 ? "전" : "후"}`;
}

const STATUS_WORD = { estimated: "추정", interpolated: "보간", reference: "참조" };

/** Compact primary-readout suffix; null when nothing is shown on the map. */
export function shuttleRefReadout(ref) {
  return ref ? `셔틀 지도 위치 ≈ ${STATUS_WORD[ref.status]} (조건부)` : null;
}

/** Court caption: player manual floor reference and conditional shuttle estimate, no 3D claim. */
export function shuttleCaption(modelAvail, playersMapped, shuttleRef) {
  if (!shuttleRef) return courtCaption(modelAvail, playersMapped);
  const parts = [];
  if (modelAvail) parts.push("채택된 비행의 조건부 모델 위치를 그립니다. 높이와 속도는 추정입니다.");
  if (playersMapped) parts.push("선수 바닥 위치 ≈ 수동 코트 보정 기준입니다.");
  parts.push("셔틀 위치 ≈ 카메라와 높이 가정 아래 조건부 추정입니다. 측정한 3D 위치, 속도, 착지가 아닙니다.");
  return parts.join(" ");
}

/**
 * Off-court value: direction-only arrow where the ray from the box centre toward `xy` leaves
 * the drawable box (metres). Null when `xy` is inside (draw the marker itself).
 */
export function shuttleEdgeArrow(xy, box) {
  const [x, y] = xy;
  if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) return null;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const dx = x - cx;
  const dy = y - cy;
  const bx = dx > 0 ? box.x1 : box.x0;
  const by = dy > 0 ? box.y1 : box.y0;
  const tx = dx !== 0 ? (bx - cx) / dx : Infinity;
  const ty = dy !== 0 ? (by - cy) / dy : Infinity;
  const angle = Math.atan2(dy, dx);
  return tx <= ty ? { x: bx, y: cy + tx * dy, angle } : { x: cx + ty * dx, y: by, angle };
}

/** Top-left of a w x h label beside a marker of radius r, kept fully inside the canvas. */
export function shuttleLabelBox(mx, my, w, h, r, cw, ch, pad = 2) {
  let x = mx + r;
  let y = my - r - h;
  if (x + w > cw - pad) x = mx - r - w;
  if (y < pad) y = my + r;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  return { x: clamp(x, pad, cw - pad - w), y: clamp(y, pad, ch - pad - h) };
}
