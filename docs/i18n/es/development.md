# Desarrollo

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

## Generar esta documentación

La documentación usa Sphinx, Furo y MyST. Sus dependencias están en el grupo
de dependencias `docs` y no son dependencias de ejecución.

```bash
uv sync --locked --only-group docs
uv run --only-group docs python docs/build.py
uv run --only-group docs python docs/verify_i18n.py
```

`docs/build.py` limpia `docs/_build/html` y ejecuta una compilación estricta
de Sphinx (`-n -W --keep-going`) por idioma: inglés en la raíz y los otros
nueve idiomas en `zh/`, `ja/`, `ru/`, `ko/`, `es/`, `fr/`, `de/`, `pt-BR/` e
`it/`. Pasa `--lang en` (repetible) para compilar solo algunos idiomas. Un
solo idioma también puede compilarse directamente, por ejemplo
`DOCS_LANG=ja uv run --only-group docs sphinx-build -n -W --keep-going -b html docs docs/_build/html/ja`.

Las fuentes en inglés son `docs/*.md`. Las traducciones están en
`docs/i18n/<language>/` con los mismos nombres de archivo; una traducción que
falta hace fallar la compilación en lugar de recurrir al inglés. Los bloques
de código, los comandos de la CLI, el JSON y los anclajes deben ser idénticos
a la fuente en inglés; `docs/verify_i18n.py` comprueba esto y el sitio
generado.

Abre `docs/_build/html/index.html`, o sirve `docs/_build/html` con
`python -m http.server` para probar el selector de idioma. El sitio se
despliega en GitHub Pages mediante `.github/workflows/docs.yml` en cada push a
`main`.
