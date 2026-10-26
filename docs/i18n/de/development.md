# Entwicklung

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

## Diese Dokumentation bauen

Die Dokumentation verwendet Sphinx, Furo und MyST. Ihre Abhängigkeiten liegen
in der Abhängigkeitsgruppe `docs` und sind keine Laufzeitabhängigkeiten.

```bash
uv sync --locked --only-group docs
uv run --only-group docs python docs/build.py
uv run --only-group docs python docs/verify_i18n.py
```

`docs/build.py` leert `docs/_build/html` und führt pro Sprache einen strikten
Sphinx-Build (`-n -W --keep-going`) aus: Englisch im Wurzelverzeichnis und die
anderen neun Sprachen unter `zh/`, `ja/`, `ru/`, `ko/`, `es/`, `fr/`, `de/`,
`pt-BR/` und `it/`. Übergeben Sie `--lang en` (wiederholbar), um nur einige
Sprachen zu bauen. Eine einzelne Sprache kann auch direkt gebaut werden, zum
Beispiel
`DOCS_LANG=ja uv run --only-group docs sphinx-build -n -W --keep-going -b html docs docs/_build/html/ja`.

Die englischen Quellen sind `docs/*.md`. Übersetzungen liegen in
`docs/i18n/<language>/` mit denselben Dateinamen; eine fehlende Übersetzung
lässt den Build fehlschlagen, statt auf Englisch zurückzufallen. Codeblöcke,
CLI-Befehle, JSON und Anker müssen mit der englischen Quelle identisch
bleiben; `docs/verify_i18n.py` prüft dies und die gebaute Seite.

Öffnen Sie `docs/_build/html/index.html` oder stellen Sie `docs/_build/html`
mit `python -m http.server` bereit, um die Sprachauswahl auszuprobieren. Die
Seite wird bei Pushes auf `main` durch `.github/workflows/docs.yml` auf GitHub
Pages bereitgestellt.
