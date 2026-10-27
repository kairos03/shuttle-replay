// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SAMPLE_PATH = fileURLToPath(new URL("../demo/assets/sample/analysis.json", import.meta.url));
export const sampleText = () => readFileSync(SAMPLE_PATH, "utf8");

/** Small hand-built analysis: two segments split by a cut, a detection gap,
 *  two accepted flights in segment 0 and one rejected flight in segment 1. */
export function fixture() {
  const fr = (id, pts, seg, layer, extra = {}) => ({
    frame_id: id, pts_s: pts, segment_id: seg, layer,
    shuttle_observed_px: null, model_flight_id: null, shuttle_model_xyz_m: null, shuttle_model_px: null,
    players: [], ...extra,
  });
  const m = (flight, x) => ({
    model_flight_id: flight, shuttle_model_px: [x, 50], shuttle_model_xyz_m: [1, x / 10, 1.5],
    layer: "conditional_model",
  });
  return {
    schema: "shuttle-replay/analysis/v1",
    synthetic: true,
    source_video: "clip.mp4",
    segments: [
      { segment_id: 0, start_s: 0.0, end_s: 0.2335 },
      { segment_id: 1, start_s: 0.4, end_s: 0.5 },
    ],
    flights: [
      { id: "fa", contact_id: "a", segment_id: 0, t0_s: 0.0, t_end_s: 0.1, accepted: true, status: "accepted", end_type: "intercepted_by_next_contact", model_speed_coarse_km_h: 100 },
      { id: "fb", contact_id: "b", segment_id: 0, t0_s: 0.1, t_end_s: 0.2335, accepted: true, status: "accepted", end_type: "open_segment_end", model_speed_coarse_km_h: 60 },
      { id: "fr", contact_id: "r", segment_id: 1, t0_s: 0.4, accepted: false, status: "insufficient_observations", end_type: "open_segment_end", params: null },
    ],
    frames: [
      fr(0, 0.0, 0, "conditional_model", { shuttle_observed_px: [10, 10], ...m("fa", 10) }),
      fr(1, 0.0333, 0, "conditional_model", { shuttle_observed_px: [11, 10], ...m("fa", 11) }),
      fr(2, 0.0667, 0, "conditional_model", { ...m("fa", 12) }), // detection gap
      fr(3, 0.1001, 0, "conditional_model", { shuttle_observed_px: [13, 10], ...m("fb", 13) }), // flight boundary (VFR step)
      fr(4, 0.1335, 0, "conditional_model", { shuttle_observed_px: [14, 10], ...m("fb", 14) }),
      fr(5, 0.1668, 0, "conditional_model", { shuttle_observed_px: [15, 10], ...m("fb", 15) }),
      fr(6, 0.2002, 0, "conditional_model", { shuttle_observed_px: [16, 10], ...m("fb", 16) }),
      fr(7, 0.2335, 0, "conditional_model", { shuttle_observed_px: [17, 10], ...m("fb", 17) }),
      fr(8, 0.2669, null, "excluded_camera_cut", { raw_detection_ignored: true }),
      fr(9, 0.3669, null, "excluded_camera_cut"),
      fr(10, 0.4, 1, "observed_pixel", { shuttle_observed_px: [40, 40] }),
      fr(11, 0.4333, 1, "observed_pixel", { shuttle_observed_px: [41, 40] }),
      fr(12, 0.4667, 1, "none"),
      fr(13, 0.5, 1, "observed_pixel", { shuttle_observed_px: [43, 40] }),
    ],
  };
}

export const clone = (o) => JSON.parse(JSON.stringify(o));
