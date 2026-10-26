# Разработка

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

## Сборка этой документации

Документация использует Sphinx, Furo и MyST. Их зависимости находятся в группе
зависимостей `docs` и не являются зависимостями времени выполнения.

```bash
uv sync --locked --only-group docs
uv run --only-group docs python docs/build.py
uv run --only-group docs python docs/verify_i18n.py
```

`docs/build.py` очищает `docs/_build/html` и выполняет одну строгую сборку
Sphinx (`-n -W --keep-going`) для каждого языка: английский в корне, а
остальные девять языков в `zh/`, `ja/`, `ru/`, `ko/`, `es/`, `fr/`, `de/`,
`pt-BR/` и `it/`. Передайте `--lang en` (можно повторять), чтобы собрать
только некоторые языки. Отдельный язык можно также собрать напрямую,
например
`DOCS_LANG=ja uv run --only-group docs sphinx-build -n -W --keep-going -b html docs docs/_build/html/ja`.

Английские исходники находятся в `docs/*.md`. Переводы лежат в
`docs/i18n/<language>/` с теми же именами файлов; отсутствующий перевод
приводит к ошибке сборки, а не к откату на английский. Блоки кода, команды
CLI, JSON и якоря должны оставаться идентичными английскому исходнику;
`docs/verify_i18n.py` проверяет это и собранный сайт.

Откройте `docs/_build/html/index.html` или раздайте `docs/_build/html` с
помощью `python -m http.server`, чтобы попробовать переключатель языка. Сайт
развёртывается на GitHub Pages с помощью `.github/workflows/docs.yml` при
пушах в `main`.
