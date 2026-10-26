# SPDX-License-Identifier: AGPL-3.0-only
"""Physics-constrained flight fitting from supplied detections and reviewed annotations.

Each flight starts at a reviewed contact (flight time zero) and ends at the
next reviewed contact in the same camera segment (intercepted), at an
annotated landing region, or at the last observation of the segment (open).
Flights never cross camera segments. Fits combine 2D pixel residuals of the
supplied detections with explicit priors; results are conditional models,
not measurements.
"""

import numpy as np
from scipy.optimize import least_squares

from .court import NET_Y_M, inside_court
from .geometry import project, ray_at_height
from .inputs import validate_inputs
from .physics import floor_crossing, net_crossing_height, physical_gates, simulate

SCHEMA = "shuttle-replay/analysis/v1"
DEFAULT_PHYSICS = {
    "gravity_m_s2": 9.81,
    "pixel_sigma_px": 3.0,
    "drag_prior_per_m": 0.18,
    "drag_prior_sigma": 0.15,
    "drag_bounds_per_m": [0.015, 0.6],
    "contact_guard_s": 0.02,
    "contact_xy_sigma_m": 0.5,
    "velocity_bound_m_s": 120.0,
    "min_observations": 4,
    "max_accept_rms_px": 8.0,
}
PROVENANCE = {
    "observed_pixel": "supplied 2D detection, unchanged (null when the detector reported none)",
    "human_review": "reviewed contact time/height/position, landing region or calibration point",
    "conditional_model": "gravity+drag model fitted to observed pixels under reviewed priors",
    "display_interpolation": "renderer-only drawing between model samples (trails, rings)",
}
ASSUMPTIONS = [
    "Camera P is metric only within the stated calibration scope (court plane + net anchors).",
    "Contact heights and positions are reviewed priors with stated sigmas, not measured contacts.",
    "Drag coefficient is fitted per flight with a weak prior; speeds are model speeds, "
    "not radar measurements.",
    "Landing regions constrain the model; the reported landing point is not a measured coordinate.",
    "Low reprojection error shows 2D consistency only; it is not independent 3D accuracy proof.",
]


def _contact_prior(contact, P):
    h = float(contact["height_m"])
    if contact.get("image_px") is not None:
        return ray_at_height(P, contact["image_px"], h), "image_px ray at reviewed height"
    x, y = contact["court_xy_m"]
    return np.array([x, y, h]), "reviewed court_xy_m at reviewed height"


def fit_flight(P, t_obs, uv_obs, start, start_sigma, end, cfg, crosses_net):
    """Fit [x, y, z, vx, vy, vz, k] (+ landing time) to observed pixels and priors.

    end: {"type": "intercepted", "duration": D, "xyz": prior, "sigma": s}
         {"type": "landing", "bracket": (lo, hi), "min": xy, "max": xy}
         {"type": "open", "duration": D}
    """
    g = cfg["gravity_m_s2"]
    t_obs, uv_obs = np.asarray(t_obs, float), np.asarray(uv_obs, float)
    k_lo, k_hi = cfg["drag_bounds_per_m"]
    vb = float(cfg["velocity_bound_m_s"])
    lo = np.array([-3, -3, 0.05, -vb, -vb, -vb, k_lo])
    hi = np.array([9.1, 16.4, 4.5, vb, vb, vb, k_hi])
    landing = end["type"] == "landing"
    if landing:
        lo = np.r_[lo, end["bracket"][0]]
        hi = np.r_[hi, end["bracket"][1]]
        rmin, rmax = np.asarray(end["min"], float), np.asarray(end["max"], float)
        target = np.r_[(rmin + rmax) / 2, 0.0]
        seed_d = float(np.mean(end["bracket"]))
    elif end["type"] == "intercepted":
        target, seed_d = np.asarray(end["xyz"], float), end["duration"]
    else:
        seed_d = end["duration"]
        target = ray_at_height(P, uv_obs[-1], max(start[2], 0.5))

    def unpack(q):
        return q[:7], (q[7] if landing else end["duration"])

    def residual(q):
        p, dur = unpack(q)
        grid = np.linspace(0, dur, 41)
        xyz = simulate(p, np.r_[t_obs, dur, grid], g)
        r = [
            ((project(P, xyz[: len(t_obs)]) - uv_obs) / cfg["pixel_sigma_px"]).ravel(),
            (p[:3] - start) / start_sigma,
            [(p[6] - cfg["drag_prior_per_m"]) / cfg["drag_prior_sigma"]],
        ]
        e = xyz[len(t_obs)]
        if end["type"] == "intercepted":
            r.append((e - end["xyz"]) / end["sigma"])
        if landing:
            r.append([e[2] / 0.01])
            r.append((np.maximum(rmin - e[:2], 0) + np.maximum(e[:2] - rmax, 0)) / 0.02)
        path = xyz[-len(grid) :]
        r.append(np.minimum(path[:, 2], 0) / 0.01)
        if crosses_net:
            nh = net_crossing_height(path)
            r.append([max(0.0, 1.55 - (nh if nh is not None else 0.0)) / 0.02])
        return np.concatenate([np.atleast_1d(x) for x in r])

    best = None
    for k0 in (0.1, 0.2, 0.35):
        for lift in (1.0, 3.0):
            v = (target - start) / seed_d * 1.4
            v[2] += 4.905 * seed_d + lift
            q0 = np.r_[start, v, k0] if not landing else np.r_[start, v, k0, seed_d]
            q0 = np.clip(q0, lo + 1e-6, hi - 1e-6)
            sol = least_squares(
                residual,
                q0,
                bounds=(lo, hi),
                loss="soft_l1",
                f_scale=1.5,
                max_nfev=400,
                xtol=1e-8,
                ftol=1e-8,
                gtol=1e-8,
            )
            if best is None or sol.cost < best.cost:
                best = sol
    p, dur = unpack(best.x)
    names = ["x", "y", "z", "vx", "vy", "vz", "drag_k"]
    span = hi[:7] - lo[:7]
    at_bound = [
        n
        for n, v, a, b, w in zip(names, p, lo[:7], hi[:7], span, strict=True)
        if min(v - a, b - v) < 1e-3 * w
    ]
    err = np.linalg.norm(project(P, simulate(p, t_obs, g)) - uv_obs, axis=1)
    return (
        p,
        float(dur),
        {
            "reprojection_rms_px": float(np.sqrt(np.mean(err**2))),
            "reprojection_p90_px": float(np.percentile(err, 90)),
            "reprojection_max_px": float(err.max()),
            "n_observations": int(len(t_obs)),
            "optimizer_success": bool(best.success),
            "nfev": int(best.nfev),
            "cost": float(best.cost),
            "seeds_tried": 6,
            "parameters_at_bound": at_bound,
        },
    )


def analyze(tracks, review, calibration):
    segments, cams, ends = validate_inputs(tracks, review, calibration)
    cfg = {**DEFAULT_PHYSICS, **(review.get("physics") or {})}
    g = cfg["gravity_m_s2"]
    frames = tracks["frames"]
    by_seg = {}
    for c in sorted(review["contacts"], key=lambda c: c["time_s"]):
        by_seg.setdefault(c["segment_id"], []).append(c)

    flights = []
    for seg, contacts in by_seg.items():
        P = np.asarray(cams[seg]["P"], float)
        seg_frames = [f for f in frames if f["segment_id"] == seg]
        for i, c in enumerate(contacts):
            nxt = contacts[i + 1] if i + 1 < len(contacts) else None
            t0 = float(c["time_s"])
            start, start_basis = _contact_prior(c, P)
            sxy = float(c.get("xy_sigma_m", cfg["contact_xy_sigma_m"]))
            start_sigma = np.array([sxy, sxy, float(c.get("height_sigma_m", 0.3))])
            spec = ends.get(c["id"], {"type": "open"})
            guard = cfg["contact_guard_s"]
            if nxt is not None:
                t_hi = float(nxt["time_s"])
                end_xyz, _ = _contact_prior(nxt, P)
                ns = float(nxt.get("xy_sigma_m", cfg["contact_xy_sigma_m"]))
                end = {
                    "type": "intercepted",
                    "duration": t_hi - t0,
                    "xyz": end_xyz,
                    "sigma": np.array([ns, ns, float(nxt.get("height_sigma_m", 0.3))]),
                }
                end_type = "intercepted_by_next_contact"
                crosses = (start[1] - NET_Y_M) * (end_xyz[1] - NET_Y_M) < 0
            elif spec["type"] == "landing_region":
                lo_t, hi_t = spec["time_bracket_s"]
                t_hi = hi_t
                reg = spec["region_xy_m"]
                end = {
                    "type": "landing",
                    "bracket": (lo_t - t0, hi_t - t0),
                    "min": reg["min"],
                    "max": reg["max"],
                }
                end_type = "landing_region"
                cy = (reg["min"][1] + reg["max"][1]) / 2
                crosses = (start[1] - NET_Y_M) * (cy - NET_Y_M) < 0
            else:
                t_hi = min(segments[seg]["end_s"], float(spec.get("until_s", np.inf)))
                end, end_type, crosses = None, "open_segment_end", False
            obs = [
                f
                for f in seg_frames
                if f["shuttle"] is not None
                and t0 + guard < f["pts_s"] <= t_hi - (guard if nxt is not None else 0)
            ]
            record = {
                "id": f"flight_{c['id']}",
                "contact_id": c["id"],
                "segment_id": seg,
                "t0_s": t0,
                "t0_basis": "reviewed contact timestamp (human_review)",
                "contact_time_bracket_s": c["time_bracket_s"],
                "start_prior_m": start.tolist(),
                "start_prior_basis": start_basis,
                "start_prior_sigma_m": start_sigma.tolist(),
                "end_type": end_type,
                "next_contact_id": nxt["id"] if nxt else None,
                "net_crossing_required": bool(crosses),
                "observation_frame_ids": [f["frame_id"] for f in obs],
                "observation_time_offsets_s": [f["pts_s"] - t0 for f in obs],
                "first_observation_delay_s": (obs[0]["pts_s"] - t0) if obs else None,
                "review": {"contact": c.get("review"), "end": spec.get("review")},
                "params": None,
                "accepted": False,
                "landing": None,
                "unreturned_floor_crossing_prediction": None,
            }
            flights.append(record)
            if len(obs) < cfg["min_observations"]:
                record["status"] = "insufficient_observations"
                continue
            t_obs = np.array(record["observation_time_offsets_s"])
            uv = np.array([[f["shuttle"]["u"], f["shuttle"]["v"]] for f in obs])
            if end is None:
                end = {"type": "open", "duration": float(t_obs[-1])}
            p, dur, fit = fit_flight(P, t_obs, uv, start, start_sigma, end, cfg, crosses)
            path = simulate(p, np.linspace(0, dur, 201), g)
            gates = physical_gates(path, crosses)
            accepted = (
                fit["optimizer_success"]
                and gates["floor_ok"]
                and gates["net_ok"]
                and fit["reprojection_rms_px"] <= cfg["max_accept_rms_px"]
                and not fit["parameters_at_bound"]
            )
            speed = float(np.linalg.norm(p[3:6]) * 3.6)
            record.update(
                {
                    "status": "accepted" if accepted else "rejected_by_gates_or_fit",
                    "accepted": bool(accepted),
                    "parameters_at_bound": fit["parameters_at_bound"],
                    "params": p.tolist(),
                    "params_layout": "[x, y, z, vx, vy, vz, drag_k] at contact (time zero)",
                    "t_end_s": t0 + dur,
                    "end_position_m": path[-1].tolist(),
                    "fit": fit,
                    "gates": gates,
                    "model_speed_km_h": speed,
                    "model_speed_coarse_km_h": int(5 * round(speed / 5)),
                    "speed_scope": "initial speed of the conditional model; not a measured speed",
                }
            )
            if end_type == "landing_region":
                reg = spec["region_xy_m"]
                xy = path[-1, :2]
                record["landing"] = {
                    "time_s": t0 + dur,
                    "xy_m": xy.tolist(),
                    "within_region": bool(
                        all(reg["min"][j] - 1e-3 <= xy[j] <= reg["max"][j] + 1e-3 for j in range(2))
                    ),
                    "region_xy_m": reg,
                    "provenance": "human_review_region+conditional_model",
                    "exact_coordinate_measured": False,
                    "inside_court": inside_court(*xy),
                }
            else:
                fc = floor_crossing(p, g)
                if fc is not None and fc[0] > dur:
                    record["unreturned_floor_crossing_prediction"] = {
                        "time_s": t0 + fc[0],
                        "xy_m": fc[1][:2].tolist(),
                        "kind": "counterfactual_if_unreturned",
                        "observed": False,
                        "inside_court": inside_court(*fc[1][:2]),
                        "note": "where this model would reach the floor had nobody returned it; "
                        "not the shuttle's actual path",
                    }

    model_flights = [f for f in flights if f["accepted"]]
    out_frames = []
    for f in frames:
        seg = f["segment_id"]
        raw = f["shuttle"]
        rec = {
            "frame_id": f["frame_id"],
            "pts_s": f["pts_s"],
            "segment_id": seg,
            "shuttle_observed_px": None,
            "model_flight_id": None,
            "shuttle_model_xyz_m": None,
            "shuttle_model_px": None,
            "players": f.get("players") or [],
        }
        if seg is None:
            rec["layer"] = "excluded_camera_cut"
            rec["raw_detection_ignored"] = raw is not None
            rec["players"] = []
            out_frames.append(rec)
            continue
        if raw is not None:
            rec["shuttle_observed_px"] = [raw["u"], raw["v"]]
        hit = next(
            (
                m
                for m in model_flights
                if m["segment_id"] == seg and m["t0_s"] <= f["pts_s"] <= m["t_end_s"]
            ),
            None,
        )
        if hit is not None:
            xyz = simulate(hit["params"], [f["pts_s"] - hit["t0_s"]], g)[0]
            rec.update(
                model_flight_id=hit["id"],
                shuttle_model_xyz_m=xyz.tolist(),
                shuttle_model_px=project(cams[seg]["P"], xyz)[0].tolist(),
                layer="conditional_model",
            )
        else:
            rec["layer"] = "observed_pixel" if raw is not None else "none"
        out_frames.append(rec)

    return {
        "schema": SCHEMA,
        "synthetic": bool(tracks.get("synthetic") or review.get("synthetic")),
        "source_video": tracks.get("source_video"),
        "physics": cfg,
        "assumptions": ASSUMPTIONS,
        "provenance_vocabulary": PROVENANCE,
        "segments": sorted(segments.values(), key=lambda s: s["start_s"]),
        "calibration_summary": [
            {
                "segment_id": s["segment_id"],
                "heldout_summary": s["heldout_summary"],
                "net_anchor_sensitivity": s["net_anchor_sensitivity"],
            }
            for s in calibration["segments"]
        ],
        "flights": flights,
        "frames": out_frames,
    }
