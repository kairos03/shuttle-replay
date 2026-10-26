# Sviluppo

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

## Generare questa documentazione

La documentazione usa Sphinx, Furo e MyST. Le loro dipendenze si trovano nel
gruppo di dipendenze `docs` e non sono dipendenze di runtime.

```bash
uv sync --locked --only-group docs
uv run --only-group docs python docs/build.py
uv run --only-group docs python docs/verify_i18n.py
```

`docs/build.py` pulisce `docs/_build/html` ed esegue una build Sphinx rigorosa
(`-n -W --keep-going`) per lingua: l'inglese nella radice e le altre nove
lingue in `zh/`, `ja/`, `ru/`, `ko/`, `es/`, `fr/`, `de/`, `pt-BR/` e `it/`.
Passa `--lang en` (ripetibile) per generare solo alcune lingue. Una singola
lingua può anche essere generata direttamente, per esempio
`DOCS_LANG=ja uv run --only-group docs sphinx-build -n -W --keep-going -b html docs docs/_build/html/ja`.

I sorgenti in inglese sono `docs/*.md`. Le traduzioni si trovano in
`docs/i18n/<language>/` con gli stessi nomi di file; una traduzione mancante
fa fallire la build invece di ripiegare sull'inglese. Blocchi di codice,
comandi della CLI, JSON e ancore devono restare identici al sorgente inglese;
`docs/verify_i18n.py` controlla questo e il sito generato.

Apri `docs/_build/html/index.html`, oppure servi `docs/_build/html` con
`python -m http.server` per provare il selettore di lingua. Il sito viene
pubblicato su GitHub Pages da `.github/workflows/docs.yml` a ogni push su
`main`.
