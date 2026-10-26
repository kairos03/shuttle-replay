# Development

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

## Building these docs

The docs use Sphinx, Furo and MyST. Their dependencies live in the `docs`
dependency group and are not runtime dependencies.

```bash
uv sync --locked --only-group docs
uv run --only-group docs python docs/build.py
uv run --only-group docs python docs/verify_i18n.py
```

`docs/build.py` cleans `docs/_build/html` and runs one strict Sphinx build
(`-n -W --keep-going`) per language: English at the root and the other nine
languages under `zh/`, `ja/`, `ru/`, `ko/`, `es/`, `fr/`, `de/`, `pt-BR/` and
`it/`. Pass `--lang en` (repeatable) to build only some languages. A single
language can also be built directly, for example
`DOCS_LANG=ja uv run --only-group docs sphinx-build -n -W --keep-going -b html docs docs/_build/html/ja`.

The English sources are `docs/*.md`. Translations live in
`docs/i18n/<language>/` with the same file names; a missing translation fails
the build instead of falling back to English. Code blocks, CLI commands, JSON
and anchors must stay identical to the English source; `docs/verify_i18n.py`
checks this and the built site.

Open `docs/_build/html/index.html`, or serve `docs/_build/html` with
`python -m http.server` to try the language selector. The site is deployed to GitHub Pages by
`.github/workflows/docs.yml` on pushes to `main`.
