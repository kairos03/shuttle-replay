# 开发

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

## 构建本文档

文档使用 Sphinx、Furo 和 MyST。它们的依赖位于 `docs` 依赖组中，不属于运行时依赖。

```bash
uv sync --locked --only-group docs
uv run --only-group docs python docs/build.py
uv run --only-group docs python docs/verify_i18n.py
```

`docs/build.py` 会清理 `docs/_build/html`，并为每种语言运行一次严格的 Sphinx 构建（`-n -W --keep-going`）：英文位于根目录，其他九种语言分别位于 `zh/`、`ja/`、`ru/`、`ko/`、`es/`、`fr/`、`de/`、`pt-BR/` 和 `it/` 下。传入 `--lang en`（可重复）即可只构建部分语言。也可以直接构建单一语言，例如 `DOCS_LANG=ja uv run --only-group docs sphinx-build -n -W --keep-going -b html docs docs/_build/html/ja`。

英文源文件是 `docs/*.md`。翻译位于 `docs/i18n/<language>/` 中，文件名相同；缺少翻译会导致构建失败，而不会回退到英文。代码块、CLI 命令、JSON 和锚点必须与英文源文件保持一致；`docs/verify_i18n.py` 会检查这一点以及构建出的网站。

打开 `docs/_build/html/index.html`，或使用 `python -m http.server` 托管 `docs/_build/html` 来试用语言选择器。网站在推送到 `main` 时由 `.github/workflows/docs.yml` 部署到 GitHub Pages。
