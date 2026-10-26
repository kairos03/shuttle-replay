"""Sphinx configuration for the shuttle-replay documentation site.

Metadata is read from pyproject.toml; the package itself is never imported.
"""

import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_meta = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]

project = _meta["name"]
author = "KAIROS03"
copyright = "KAIROS03"
release = _meta["version"]
version = release

extensions = ["myst_parser"]
source_suffix = {".md": "markdown"}
root_doc = "index"
exclude_patterns = ["_build", "_extra", "Thumbs.db", ".DS_Store"]
myst_heading_anchors = 3

html_theme = "furo"
html_title = f"shuttle-replay {release}"
html_static_path = []
html_extra_path = ["_extra"]
html_baseurl = "https://kairos03.github.io/shuttle-replay/"
html_theme_options = {
    "light_css_variables": {
        "color-brand-primary": "#1f6b45",
        "color-brand-content": "#1f6b45",
    },
    "dark_css_variables": {
        "color-brand-primary": "#8fcf6a",
        "color-brand-content": "#8fcf6a",
    },
    "source_repository": "https://github.com/KAIROS03/shuttle-replay/",
    "source_branch": "main",
    "source_directory": "docs/",
}

# Links in existing Markdown point at repository-root files so they work on GitHub.
# Inside Sphinx only, rewrite them to the license page that includes those files.
_LINK_REWRITES = {
    "](../LICENSE)": "](license.md)",
    "](../NOTICE.md)": "](license.md#third-party-notices)",
}


def _rewrite_repo_links(app, docname, source):
    text = source[0]
    for old, new in _LINK_REWRITES.items():
        text = text.replace(old, new)
    source[0] = text


def setup(app):
    app.connect("source-read", _rewrite_repo_links)
