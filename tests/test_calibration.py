# SPDX-License-Identifier: AGPL-3.0-only
import numpy as np
import pytest

from shuttle_replay.calibration import CalibrationError, calibrate
from shuttle_replay.geometry import apply_homography, look_at_camera, project

P_TRUE = look_at_camera([3.05, 19.5, 6.0], [3.05, 6.0, 0.0], 700.0, (640, 480))


def _segment(fit_world, heldout_world, noise=0.0, seed=0):
    rng = np.random.default_rng(seed)

    def pt(name, w, role):
        uv = project(P_TRUE, [w[0], w[1], 0.0])[0] + rng.normal(0, noise, 2)
        return {"name": name, "world_m": list(w), "image_px": uv.tolist(), "role": role}

    pts = [pt(f"f{i}", w, "fit") for i, w in enumerate(fit_world)]
    pts += [pt(f"h{i}", w, "heldout") for i, w in enumerate(heldout_world)]
    anchors = [
        {"name": n, "world_m": w, "image_px": project(P_TRUE, w)[0].tolist(), "uncertainty_px": 2.0}
        for n, w in (("left_post", [0.0, 6.7, 1.55]), ("right_post", [6.1, 6.7, 1.55]))
    ]
    return {"segment_id": 0, "image_size": [640, 480], "ground_points": pts, "net_anchors": anchors}


CORNERS = [(0, 0), (6.1, 0), (6.1, 13.4), (0, 13.4)]
INTERIOR = [(0.46, 4.72), (5.64, 8.68), (3.05, 0.76)]


def test_calibration_recovers_camera_and_reports_heldout_separately():
    out = calibrate({"segments": [_segment(CORNERS, INTERIOR, noise=0.5)]})
    seg = out["segments"][0]
    # Training residuals and held-out errors are distinct reports.
    assert {r["name"] for r in seg["fit_ground_residuals"]} == {"f0", "f1", "f2", "f3"}
    assert {r["name"] for r in seg["heldout_ground_errors"]} == {"h0", "h1", "h2"}
    assert seg["heldout_summary"]["n"] == 3
    assert 0 < seg["heldout_summary"]["max_px"] < 3.0
    assert seg["heldout_summary"]["max_m"] < 0.2
    # Airborne point projects through P (with elevated anchors), close to the truth.
    xyz = [2.0, 9.0, 3.5]
    assert np.linalg.norm(project(seg["P"], xyz) - project(P_TRUE, xyz)) < 4.0
    # Floor homography is only for Z=0 and is labelled as such.
    assert "Z=0" in seg["H_scope"]
    assert seg["net_anchor_sensitivity"]["max_vertical_shift_m"] > 0
    assert seg["inputs"]["ground_points"][0]["name"] == "f0"
    floor = apply_homography(seg["H_image_to_world"], project(P_TRUE, [1.0, 2.0, 0.0]))[0]
    assert np.allclose(floor, [1.0, 2.0], atol=0.15)


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda s: s["ground_points"].__setitem__(slice(4, None), []), "held-out"),
        (lambda s: s["ground_points"][0]["image_px"].__setitem__(0, float("nan")), "finite"),
        (lambda s: s["net_anchors"].pop(), "two elevated"),
        (lambda s: s["net_anchors"][0]["world_m"].__setitem__(2, 0.0), "elevated"),
        (
            lambda s: s["ground_points"].__setitem__(1, dict(s["ground_points"][0], name="dup")),
            "degenerate",
        ),
    ],
)
def test_calibration_rejects_invalid_inputs(mutate, message):
    seg = _segment(CORNERS, INTERIOR)
    mutate(seg)
    with pytest.raises(CalibrationError, match=message):
        calibrate({"segments": [seg]})


def test_calibration_rejects_collinear_fit_points():
    seg = _segment([(0, 0), (0, 4), (0, 8), (0, 13.4)], INTERIOR)
    with pytest.raises(CalibrationError, match="degenerate"):
        calibrate({"segments": [seg]})
