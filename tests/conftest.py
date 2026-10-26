# SPDX-License-Identifier: AGPL-3.0-only
import json

import pytest

from shuttle_replay.analysis import analyze
from shuttle_replay.calibration import calibrate
from shuttle_replay.synthetic import build_scene


@pytest.fixture(scope="session")
def scene(tmp_path_factory):
    out = tmp_path_factory.mktemp("synthetic")
    paths, truth = build_scene(out)
    data = {k: json.loads(paths[k].read_text()) for k in ("tracks", "review", "calibration_input")}
    data["calibration"] = calibrate(data["calibration_input"])
    return {"paths": paths, "truth": truth, **data}


@pytest.fixture(scope="session")
def analysis(scene):
    return analyze(scene["tracks"], scene["review"], scene["calibration"])
