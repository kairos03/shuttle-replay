# SPDX-License-Identifier: AGPL-3.0-only
"""The static web demo ships pipeline-generated sample data and is copied into the docs site."""

import importlib.util
import json
import math
import re
from pathlib import Path

from shuttle_replay.court import court_lines

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
DEMO = WEB / "demo"
SAMPLE = DEMO / "assets" / "sample"


def _load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _close(a, b, path="$"):
    if isinstance(a, float) or isinstance(b, float):
        assert math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-6), path
    elif isinstance(a, dict):
        assert a.keys() == b.keys(), path
        for k in a:
            _close(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list):
        assert len(a) == len(b), path
        for i, (x, y) in enumerate(zip(a, b, strict=True)):
            _close(x, y, f"{path}[{i}]")
    else:
        assert a == b, path


def test_sample_analysis_is_the_real_pipeline_output(tmp_path):
    build = _load_module(WEB / "build_sample.py", "web_build_sample")
    _video, result = build.run_pipeline(tmp_path)
    committed = json.loads((SAMPLE / "analysis.json").read_text())
    assert committed["schema"] == "shuttle-replay/analysis/v1"
    assert committed["synthetic"] is True
    _close(committed, result)


def test_sample_has_no_local_paths_and_honest_provenance():
    text = (SAMPLE / "analysis.json").read_text()
    assert not re.search(r"/Users/|/home/|/tmp/|[A-Za-z]:\\\\", text)
    prov = json.loads((SAMPLE / "provenance.json").read_text())
    assert prov["synthetic"] is True and prov["real_footage"] is False
    for name, info in prov["media"].items():
        assert (SAMPLE / name).stat().st_size < 1_000_000
        assert info["frames"] == len(json.loads(text)["frames"])
        assert info["max_pts_drift_vs_analysis_s"] < 0.002


def test_court_data_matches_court_module():
    js = (DEMO / "assets" / "court-data.js").read_text()
    data = json.loads(re.search(r"Object\.freeze\((\{.*\})\);", js).group(1))
    assert data["lines"] == [[list(a), list(b)] for a, b in court_lines()]


def test_demo_uses_only_relative_local_resources():
    html = (DEMO / "index.html").read_text()
    for ref in re.findall(r'(?:src|href)="([^"]+)"', html):
        if ref.startswith("https://github.com/"):
            continue  # the source link is a plain navigation link
        assert not ref.startswith(("/", "http:", "https:", "//")), ref
    for js in (DEMO / "js").glob("*.js"):
        body = js.read_text()
        assert "innerHTML" not in body, js
        assert not re.search(r"""(?:import|fetch)\s*\(?\s*["']https?:""", body), js


def test_docs_build_copies_demo_into_site(tmp_path):
    build = _load_module(ROOT / "docs" / "build.py", "docs_build")
    dest = build.copy_demo(tmp_path)
    assert dest == tmp_path / "demo"
    for rel in ("index.html", "styles.css", "js/app.js", "assets/sample/analysis.json"):
        assert (dest / rel).is_file(), rel
    assert not (dest / "tests").exists()


def test_docs_workflow_triggers_on_demo_changes_and_deploys_once():
    wf = (ROOT / ".github" / "workflows" / "docs.yml").read_text()
    assert wf.count('"web/**"') == 2  # push and pull_request path filters
    assert "node --test web/tests/" in wf
    assert wf.count("actions/deploy-pages") == 1
    assert wf.count("upload-pages-artifact") == 1
