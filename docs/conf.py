"""Sphinx configuration for the shuttle-replay documentation site.

Metadata is read from pyproject.toml; the package itself is never imported.

One Sphinx build per language. ``DOCS_LANG`` selects it (default ``en``). The
canonical English sources live in ``docs/*.md``; translations live in
``docs/i18n/<url-lang>/<same file>.md`` and replace the canonical text at
source-read time, so every locale shares the same docnames, toctree and assets.
A missing translation is a build error, never a silent English fallback.
Use ``docs/build.py`` to build the complete multilingual site.
"""

import os
import tomllib
from pathlib import Path

from sphinx.errors import ConfigError, ExtensionError

DOCS = Path(__file__).resolve().parent
ROOT = DOCS.parent
_meta = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]

# (URL directory, Sphinx language, native name). Order is the selector order.
LANGUAGES = [
    ("en", "en", "English"),
    ("zh", "zh_CN", "简体中文"),
    ("ja", "ja", "日本語"),
    ("ru", "ru", "Русский"),
    ("ko", "ko", "한국어"),
    ("es", "es", "Español"),
    ("fr", "fr", "Français"),
    ("de", "de", "Deutsch"),
    ("pt-BR", "pt_BR", "Português (Brasil)"),
    ("it", "it", "Italiano"),
]
_URL_TO_SPHINX = {url: sphinx for url, sphinx, _ in LANGUAGES}

# Selector label in each language (not part of Sphinx's own UI catalogs).
LANGUAGE_LABEL = {
    "en": "Language",
    "zh": "语言",
    "ja": "言語",
    "ru": "Язык",
    "ko": "언어",
    "es": "Idioma",
    "fr": "Langue",
    "de": "Sprache",
    "pt-BR": "Idioma",
    "it": "Lingua",
}

DOCS_LANG = os.environ.get("DOCS_LANG", "en")
if DOCS_LANG not in _URL_TO_SPHINX:
    raise ConfigError(f"DOCS_LANG={DOCS_LANG!r} is not one of {sorted(_URL_TO_SPHINX)}")
I18N_DIR = DOCS / "i18n" / DOCS_LANG

SITE_URL = "https://kairos03.github.io/shuttle-replay/"

project = _meta["name"]
author = "KAIROS03"
copyright = "KAIROS03"
release = _meta["version"]
version = release
language = _URL_TO_SPHINX[DOCS_LANG]

extensions = ["myst_parser"]
source_suffix = {".md": "markdown"}
root_doc = "index"
# i18n/ holds translated sources, read only through source-read below.
# usage.ko.md stays a GitHub-readable source; its site URL redirects to /ko/guide.html.
exclude_patterns = [
    "_build",
    "_extra",
    "_templates",
    "i18n",
    "usage.ko.md",
    "Thumbs.db",
    ".DS_Store",
]
templates_path = ["_templates"]
myst_heading_anchors = 3

html_theme = "furo"
html_title = f"shuttle-replay {release}"
html_copy_source = False
html_show_sourcelink = False
html_static_path = []
html_extra_path = ["_extra"]
html_baseurl = SITE_URL if DOCS_LANG == "en" else f"{SITE_URL}{DOCS_LANG}/"
html_search_language = language
html_context = {
    "docs_lang": DOCS_LANG,
    "docs_languages": [(url, name) for url, _, name in LANGUAGES],
    "docs_language_label": LANGUAGE_LABEL[DOCS_LANG],
    "docs_site_url": SITE_URL,
}
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
    "source_directory": "docs/" if DOCS_LANG == "en" else f"docs/i18n/{DOCS_LANG}/",
}

# Links in existing Markdown point at repository-root files so they work on GitHub.
# Inside Sphinx only, rewrite them to the license page that includes those files.
_LINK_REWRITES = {
    "](../LICENSE)": "](license.md)",
    "](../NOTICE.md)": "](#third-party-notices)",
    # Translated sources sit three levels deeper on GitHub.
    "](../../../LICENSE)": "](license.md)",
    "](../../../NOTICE.md)": "](#third-party-notices)",
}


def _relative_to_locale(current, target):
    """Relative URL prefix from the current locale root to the target locale root."""
    up = "" if current == "en" else "../"
    return up if target == "en" else f"{up}{target}/"


def _language_links_html():
    rows = [
        f'<li><a href="{_relative_to_locale(DOCS_LANG, url)}index.html" '
        f'hreflang="{url}" lang="{url}">{name}</a></li>'
        for url, _, name in LANGUAGES
    ]
    return '<ul class="docs-language-links">\n' + "\n".join(rows) + "\n</ul>"


def _read_translation(app, docname, source):
    if DOCS_LANG == "en":
        return
    path = I18N_DIR / f"{docname}.md"
    if not path.is_file():
        raise ExtensionError(
            f"missing translation for {docname!r}: {path.relative_to(ROOT)} "
            f"(DOCS_LANG={DOCS_LANG}; no English fallback)"
        )
    app.env.note_dependency(str(path))
    source[0] = path.read_text(encoding="utf-8")


def _rewrite_repo_links(app, docname, source):
    text = source[0]
    for old, new in _LINK_REWRITES.items():
        text = text.replace(old, new)
    text = text.replace("<!-- docs-language-links -->", _language_links_html())
    source[0] = text


def _page_context(app, pagename, templatename, context, doctree):
    context["docs_lang_prefix"] = {
        url: _relative_to_locale(DOCS_LANG, url) for url, _, _ in LANGUAGES
    }
    context["docs_pagename_html"] = f"{pagename}.html"


def setup(app):
    app.connect("source-read", _read_translation, priority=100)
    app.connect("source-read", _rewrite_repo_links, priority=600)
    app.connect("html-page-context", _page_context)
