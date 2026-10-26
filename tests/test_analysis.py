# SPDX-License-Identifier: AGPL-3.0-only
"""Behavioural contract of flight fitting on the synthetic rally (synthetic ground truth)."""

import numpy as np

from shuttle_replay.physics import physical_gates
from shuttle_replay.synthetic import CONTACTS, CUT_FRAMES


def _flight(analysis, contact):
    return next(f for f in analysis["flights"] if f["contact_id"] == contact)


def test_delayed_first_observation_keeps_contact_as_time_zero(analysis, scene):
    f = _flight(analysis, "c1")
    assert f["t0_s"] == 0.20
    assert f["first_observation_delay_s"] > 0.25
    # Observation offsets are measured from the reviewed contact, not the first detection.
    assert min(f["observation_time_offsets_s"]) == f["first_observation_delay_s"]
    true = next(t for t in scene["truth"]["flights"] if t["contact"] == "c1")
    assert np.linalg.norm(np.array(f["params"][:3]) - true["params"][:3]) < 0.6
    assert abs(f["model_speed_km_h"] - true["speed_km_h"]) < 0.2 * true["speed_km_h"]
    assert f["fit"]["reprojection_rms_px"] < 3.0
    assert f["accepted"]


def test_flights_never_bridge_camera_segments(analysis):
    for f in analysis["flights"]:
        frames = [r for r in analysis["frames"] if r.get("model_flight_id") == f["id"]]
        assert {r["segment_id"] for r in frames} == {f["segment_id"]}
    for r in analysis["frames"]:
        if r["frame_id"] in CUT_FRAMES:
            assert r["segment_id"] is None and r["model_flight_id"] is None
            assert r["layer"] == "excluded_camera_cut"
    c3 = _flight(analysis, "c3")
    assert c3["end_type"] == "open_segment_end"
    seg0_end = max(r["pts_s"] for r in analysis["frames"] if r["segment_id"] == 0)
    assert c3["t_end_s"] <= seg0_end
    assert analysis["segments"][0]["frame_id_range"] == [0, 74]


def test_missing_detection_provenance_is_null_not_filled(analysis, scene):
    by_id = {r["frame_id"]: r for r in scene["tracks"]["frames"]}
    modelled_gaps = 0
    for r in analysis["frames"]:
        raw = by_id[r["frame_id"]]["shuttle"]
        if raw is None:
            assert r["shuttle_observed_px"] is None
            if r["model_flight_id"] is not None:
                modelled_gaps += 1
                assert r["layer"] == "conditional_model"
        elif r["segment_id"] is not None:
            assert r["shuttle_observed_px"] == [raw["u"], raw["v"]]
    assert modelled_gaps > 5
    assert set(analysis["provenance_vocabulary"]) >= {
        "observed_pixel",
        "human_review",
        "conditional_model",
        "display_interpolation",
    }


def test_landing_region_is_a_constraint_not_a_measurement(analysis, scene):
    f = _flight(analysis, "c5")
    assert f["end_type"] == "landing_region"
    land = f["landing"]
    region = scene["review"]["flight_ends"][1]["region_xy_m"]
    assert land["exact_coordinate_measured"] is False
    assert land["provenance"] == "human_review_region+conditional_model"
    assert all(
        region["min"][i] - 0.05 <= land["xy_m"][i] <= region["max"][i] + 0.05 for i in range(2)
    )
    lo, hi = scene["review"]["flight_ends"][1]["time_bracket_s"]
    assert lo - 1e-6 <= land["time_s"] <= hi + 1e-6
    assert f["gates"]["floor_ok"] and f["gates"]["net_ok"]


def test_intercepted_flight_is_not_forced_to_land(analysis):
    f = _flight(analysis, "c2")
    assert f["end_type"] == "intercepted_by_next_contact"
    assert f["t_end_s"] == CONTACTS[2][2]
    assert f["landing"] is None
    assert f["gates"]["minimum_height_m"] > 0.5
    cf = f["unreturned_floor_crossing_prediction"]
    assert cf["kind"] == "counterfactual_if_unreturned"
    assert cf["observed"] is False and cf["time_s"] > f["t_end_s"]
    # The current airborne end position differs from the counterfactual floor point.
    assert f["end_position_m"][2] > 0.5


def test_physical_gates_reject_net_and_floor_violations():
    low = np.array([[3.0, 5.0, 1.0], [3.0, 6.7, 1.2], [3.0, 8.0, -0.3]])
    g = physical_gates(low, crosses_net=True)
    assert not g["net_ok"] and not g["floor_ok"]
    # An actual low crossing fails even when no crossing was expected.
    assert not physical_gates(low, crosses_net=False)["net_ok"]


def test_open_flight_window_and_bound_pinned_fits(scene):
    import copy

    from shuttle_replay.analysis import analyze

    review = copy.deepcopy(scene["review"])
    review["flight_ends"][0]["until_s"] = 2.42
    review["physics"] = {"velocity_bound_m_s": 20.0}
    out = analyze(scene["tracks"], review, scene["calibration"])
    c3 = _flight(out, "c3")
    assert c3["accepted"] and c3["t_end_s"] <= 2.42 + 1e-9
    # Fast synthetic flights cannot be fitted inside a 20 m/s bound: rejected, not accepted.
    c4 = _flight(out, "c4")
    assert c4["parameters_at_bound"] and not c4["accepted"]
