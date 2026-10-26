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
uv run --only-group docs sphinx-build -n -W --keep-going -b html docs docs/_build/html
```

Open `docs/_build/html/index.html`. The site is deployed to GitHub Pages by
`.github/workflows/docs.yml` on pushes to `main`.
