"""Check the multilingual docs sources and the built site.

Source checks (``docs/i18n/<lang>/`` against ``docs/*.md``): same file set,
identical fenced code blocks / directives, inline code, explicit anchors and
raw HTML markers, inline math roles; technical pages
use per-locale figures and {math} blocks with no ASCII diagrams left.
Site checks (``docs/_build/html``): ``<html lang>``, a
per-locale ``searchindex.js``, a ten-way same-page language selector on every
page, and internal links and anchors that resolve.

    uv run --only-group docs python docs/verify_i18n.py              # all ten languages
    uv run --only-group docs python docs/verify_i18n.py --lang en    # English only

Standard library only.
"""

import argparse
import re
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

DOCS = Path(__file__).resolve().parent
OUT = DOCS / "_build" / "html"
# (URL directory, expected <html lang>, native name); must match conf.LANGUAGES.
LANGUAGES = [
    ("en", "en", "English"),
    ("zh", "zh-CN", "简体中文"),
    ("ja", "ja", "日本語"),
    ("ru", "ru", "Русский"),
    ("ko", "ko", "한국어"),
    ("es", "es", "Español"),
    ("fr", "fr", "Français"),
    ("de", "de", "Deutsch"),
    ("pt-BR", "pt-BR", "Português (Brasil)"),
    ("it", "it", "Italiano"),
]
CANONICAL = [
    "index.md",
    "getting-started.md",
    "guide.md",
    "workflow.md",
    "schemas.md",
    "technology.md",
    "camera-calibration.md",
    "trajectory-physics.md",
    "observations-timing.md",
    "rendering-safety.md",
    "validation-limits.md",
    "languages.md",
    "development.md",
    "license.md",
]
PAGES = [n.removesuffix(".md") + ".html" for n in CANONICAL] + ["search.html", "genindex.html"]

_FENCE = re.compile(
    r"^(?P<indent>[ \t]*)(?P<fence>```+|~~~+)(?P<info>[^\n]*)\n"
    r"(?P<body>.*?)^(?P=indent)(?P=fence)[ \t]*$",
    re.M | re.S,
)
_ANCHOR = re.compile(r"^\(([^)\s]+)\)=[ \t]*$", re.M)
_COMMENT = re.compile(r"<!--.*?-->", re.S)
_MATH_ROLE = re.compile(r"\{math\}`([^`\n]+)`")


# Technical pages: diagrams are generated per-locale SVG figures and equations are
# {math} blocks; no ASCII diagram or equation text block may remain.
TECHNICAL = [
    "technology.md",
    "camera-calibration.md",
    "trajectory-physics.md",
    "observations-timing.md",
    "rendering-safety.md",
    "validation-limits.md",
]
FIGURES = ["pipeline", "court", "render-pipeline", "render-layout", "trajectory", "speed"]
_FIGURE_PATH = re.compile(r"^assets/technical/(?P<lang>[A-Za-z-]+)/(?P<name>[a-z-]+)\.svg$")
_OPTION = re.compile(r"^[ \t]*:[\w-]+:")


def _blocks(text, lang="en", errors=None, where=""):
    blocks = []
    for match in _FENCE.finditer(text):
        info, body = match["info"].strip(), match["body"]
        # Only human-readable image alt text and navigation captions are localized.
        # Commands, JSON, include paths, toctree targets and all other options stay exact.
        if info in ("{image}", "{toctree}") or info.startswith("{image} "):
            body = re.sub(r"^([ \t]*:(?:alt|caption):)[^\n]*$", r"\1", body, flags=re.M)
        if info.startswith("{figure} "):
            # A figure may differ only in its locale path component (which must be
            # this page's locale), its :alt: text and its caption paragraph.
            path = info.removeprefix("{figure} ").strip()
            found = _FIGURE_PATH.match(path)
            if not found or found["lang"] != lang:
                if errors is not None:
                    errors.append(
                        f"{where}: figure {path!r} is not assets/technical/{lang}/<name>.svg"
                    )
            else:
                info = f"{{figure}} assets/technical/<lang>/{found['name']}.svg"
            lines = body.splitlines()
            options = []
            for line in lines:
                if not _OPTION.match(line):
                    break
                options.append(re.sub(r"^([ \t]*:alt:)[^\n]*$", r"\1", line))
            caption = "\n".join(lines[len(options) :]).strip()
            if errors is not None and (not caption or ":alt:" not in "\n".join(options)):
                errors.append(f"{where}: figure {path!r} needs :alt: and a caption")
            body = "\n".join(options) + "\n<caption>\n"
        blocks.append((info, body))
    return blocks


def check_technical(lang, errors):
    """No ASCII diagrams/equation text blocks; figures exist for the page's locale."""
    base = DOCS if lang == "en" else DOCS / "i18n" / lang
    used = set()
    for name in TECHNICAL:
        path = base / name
        if not path.is_file():
            continue
        where = str(path.relative_to(DOCS))
        text = path.read_text(encoding="utf-8")
        for block in _FENCE.finditer(text):
            info = block["info"].strip()
            if info in ("", "text", "txt") and re.search(
                r"-->|\+--|\|.*\||\*|\s=\s", block["body"]
            ):
                errors.append(f"{where}: ASCII diagram/equation text block remains")
            if info.startswith("{figure} "):
                found = _FIGURE_PATH.match(info.removeprefix("{figure} ").strip())
                if found:
                    used.add(found["name"])
                    svg = DOCS / "assets" / "technical" / found["lang"] / f"{found['name']}.svg"
                    if not svg.is_file() or svg.stat().st_size == 0:
                        errors.append(f"{where}: missing or empty figure {svg.relative_to(DOCS)}")
                    else:
                        head = svg.read_text(encoding="utf-8")
                        if "<svg" not in head or "<title" not in head or "<script" in head:
                            errors.append(
                                f"{svg.relative_to(DOCS)}: needs <svg>, <title>, no <script>"
                            )
            if info == "{math}" and not block["body"].strip():
                errors.append(f"{where}: empty math block")
    if used != set(FIGURES):
        errors.append(f"{lang}: technical figures used {sorted(used)} != {sorted(FIGURES)}")
    example = DOCS / "assets" / "technical" / "physics-example.json"
    if lang == "en" and (
        not example.is_file()
        or "synthetic_not_measurement" not in example.read_text(encoding="utf-8")
    ):
        errors.append(
            "assets/technical/physics-example.json missing or not marked synthetic_not_measurement"
        )


def _inline_code(text):
    return Counter(re.findall(r"`([^`\n]+)`", _FENCE.sub("", text)))


def check_sources(lang, errors):
    src = DOCS / "i18n" / lang
    names = sorted(p.name for p in src.glob("*.md")) if src.is_dir() else []
    missing = sorted(set(CANONICAL) - set(names))
    extra = sorted(set(names) - set(CANONICAL))
    if missing:
        errors.append(f"{lang}: missing translations {missing}")
    if extra:
        errors.append(f"{lang}: unexpected files {extra}")
    for name in sorted(set(CANONICAL) & set(names)):
        en = (DOCS / name).read_text(encoding="utf-8")
        tr = (src / name).read_text(encoding="utf-8")
        where = f"i18n/{lang}/{name}"
        if _blocks(en, "en", errors, f"docs/{name}") != _blocks(tr, lang, errors, where):
            errors.append(f"{where}: fenced code blocks/directives differ from docs/{name}")
        en_math, tr_math = _MATH_ROLE.findall(en), _MATH_ROLE.findall(tr)
        if en_math != tr_math:
            errors.append(f"{where}: inline {{math}} roles differ from docs/{name}")
        if _inline_code(en) != _inline_code(tr):
            diff = (_inline_code(en) - _inline_code(tr)) + (_inline_code(tr) - _inline_code(en))
            errors.append(f"{where}: inline code differs: {sorted(diff)}")
        if _ANCHOR.findall(en) != _ANCHOR.findall(tr):
            errors.append(f"{where}: explicit anchors differ")
        if _COMMENT.findall(en) != _COMMENT.findall(tr):
            errors.append(f"{where}: HTML comment markers differ")


class _Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.lang = None
        self.ids = set()
        self.links = []
        self.selector = []  # (lang, href or None for current)
        self._in_selector = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html":
            self.lang = a.get("lang")
        if "id" in a:
            self.ids.add(a["id"])
        if tag == "nav" and "docs-language-selector" in (a.get("class") or ""):
            self._in_selector = True
        if self._in_selector and tag == "a":
            self.selector.append((a.get("lang"), a.get("href")))
        if self._in_selector and tag == "strong":
            self.selector.append((a.get("lang"), None))
        if tag == "a" and a.get("href"):
            self.links.append(a["href"])

    def handle_endtag(self, tag):
        if tag == "nav":
            self._in_selector = False


_PAGES = {}


def _parse(path):
    if path not in _PAGES:
        page = _Page()
        page.feed(path.read_text(encoding="utf-8"))
        _PAGES[path] = page
    return _PAGES[path]


def check_site(langs, errors):
    order = [url for url, _, _ in LANGUAGES]
    # source-read localizes parsed pages, not Sphinx's original source copies.
    # Disable those copies rather than publish English downloads in other locales.
    if any(p.is_file() for directory in OUT.rglob("_sources") for p in directory.rglob("*")):
        errors.append("unexpected _sources files: canonical English source copies must not ship")
    for url, html_lang, _ in LANGUAGES:
        if url not in langs:
            continue
        root = OUT if url == "en" else OUT / url
        if not (root / "searchindex.js").is_file():
            errors.append(f"{url}: no searchindex.js")
        for asset in ("_static/mathjax/tex-svg.js", "_static/mathjax/LICENSE"):
            if not (root / asset).is_file():
                errors.append(f"{url}: missing self-hosted {asset}")
        for name in PAGES:
            path = root / name
            if not path.is_file():
                errors.append(f"{url}: missing page {name}")
                continue
            page = _parse(path)
            rel = path.relative_to(OUT)
            html = path.read_text(encoding="utf-8")
            if re.search(r"<script[^>]+src=\"https?://[^\"]*mathjax", html, re.I):
                errors.append(f"{rel}: loads MathJax from a remote URL")
            if 'class="math' in html and 'src="_static/mathjax/tex-svg.js' not in html:
                errors.append(f"{rel}: math without the local _static/mathjax/tex-svg.js")
            if name.removesuffix(".html") + ".md" in TECHNICAL:
                for img in re.findall(r'<img[^>]+src="([^"]+)"', html):
                    if (
                        "/technical/" in img
                        and f"/technical/{url}/" not in img
                        and "technical/" + url + "/" not in img
                    ):
                        errors.append(f"{rel}: figure {img} is not the {url} locale")
            if page.lang != html_lang:
                errors.append(f"{rel}: <html lang={page.lang!r}>, expected {html_lang!r}")
            if [lang for lang, _ in page.selector] != order:
                errors.append(f"{rel}: language selector is {page.selector}")
            for lang, href in page.selector:
                if href is None:
                    if lang != url:
                        errors.append(f"{rel}: current language marked as {lang}")
                    continue
                target = (path.parent / href).resolve()
                if target.name != name:
                    errors.append(f"{rel}: selector {lang} -> {href} is not the same page")
                elif lang in langs and not target.is_file():
                    errors.append(f"{rel}: selector {lang} -> {href} does not exist")
            for href in page.links:
                parts = urlsplit(href)
                if parts.scheme or parts.netloc or href.startswith(("mailto:", "javascript:")):
                    continue
                target = (path.parent / unquote(parts.path)).resolve() if parts.path else path
                if not target.is_relative_to(OUT.resolve()):
                    errors.append(f"{rel}: link leaves the site: {href}")
                    continue
                lang_dir = target.relative_to(OUT.resolve()).parts[0]
                if lang_dir in order and lang_dir not in langs:
                    continue  # locale not built in this run
                if target.is_dir():
                    target = target / "index.html"
                if not target.is_file():
                    errors.append(f"{rel}: broken link {href}")
                elif parts.fragment and target.suffix == ".html":
                    if parts.fragment not in _parse(target).ids:
                        errors.append(f"{rel}: missing anchor {href}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--lang", action="append", choices=[u for u, _, _ in LANGUAGES])
    parser.add_argument("--sources-only", action="store_true", help="skip built-site checks")
    args = parser.parse_args(argv)
    langs = set(args.lang or [u for u, _, _ in LANGUAGES])

    errors = []
    actual = sorted(p.name for p in DOCS.glob("*.md") if p.name != "usage.ko.md")
    if actual != sorted(CANONICAL):
        errors.append(f"canonical sources {actual} != {sorted(CANONICAL)}")
    for lang in sorted(langs - {"en"}):
        check_sources(lang, errors)
    for lang in sorted(langs):
        check_technical(lang, errors)
    if not args.sources_only:
        check_site(langs, errors)

    for error in errors:
        print(f"ERROR {error}", file=sys.stderr)
    print(f"[verify] languages={','.join(sorted(langs))} errors={len(errors)}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
