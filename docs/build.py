"""Build the multilingual documentation site into docs/_build/html.

English is built at the site root; every other language is an independent
Sphinx build (own ``language``, ``<html lang>`` and search index) under
``<url-lang>/``. Each build is strict (``-n -W --keep-going``).

    uv run --only-group docs python docs/build.py            # all ten languages
    uv run --only-group docs python docs/build.py --lang en  # only English
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent
BUILD = DOCS / "_build"
OUT = BUILD / "html"
LANGS = ["en", "zh", "ja", "ru", "ko", "es", "fr", "de", "pt-BR", "it"]

# Old URL of the Korean guide, now served as the Korean locale's guide page.
_REDIRECTS = {"usage.ko.html": "ko/guide.html"}
_REDIRECT_HTML = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url={target}">
<link rel="canonical" href="https://kairos03.github.io/shuttle-replay/{target}">
<title>shuttle-replay</title>
</head>
<body><p><a href="{target}">{target}</a></p></body>
</html>
"""


def build(lang: str) -> int:
    out = OUT if lang == "en" else OUT / lang
    cmd = [
        sys.executable, "-m", "sphinx",
        "-n", "-W", "--keep-going",
        "-b", "html",
        "-d", str(BUILD / "doctrees" / lang),
        str(DOCS), str(out),
    ]  # fmt: skip
    print(f"[docs] DOCS_LANG={lang} -> {out.relative_to(DOCS.parent)}", flush=True)
    return subprocess.run(cmd, env={**os.environ, "DOCS_LANG": lang}).returncode


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--lang", action="append", choices=LANGS, help="language to build (repeatable)"
    )
    args = parser.parse_args(argv)
    langs = [lang for lang in LANGS if lang in (args.lang or LANGS)]

    shutil.rmtree(OUT, ignore_errors=True)
    shutil.rmtree(BUILD / "doctrees", ignore_errors=True)
    failed = [lang for lang in langs if build(lang) != 0]
    if "en" in langs:
        for name, target in _REDIRECTS.items():
            (OUT / name).write_text(_REDIRECT_HTML.format(target=target), encoding="utf-8")
    (OUT / ".nojekyll").touch()
    if failed:
        print(f"[docs] FAILED: {', '.join(failed)}", file=sys.stderr)
        return 1
    print(f"[docs] built {', '.join(langs)} into {OUT.relative_to(DOCS.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
