# Développement

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

## Construire cette documentation

La documentation utilise Sphinx, Furo et MyST. Leurs dépendances se trouvent
dans le groupe de dépendances `docs` et ne sont pas des dépendances
d'exécution.

```bash
uv sync --locked --only-group docs
uv run --only-group docs python docs/build.py
uv run --only-group docs python docs/verify_i18n.py
```

`docs/build.py` nettoie `docs/_build/html` et exécute une construction Sphinx
stricte (`-n -W --keep-going`) par langue : l'anglais à la racine et les neuf
autres langues sous `zh/`, `ja/`, `ru/`, `ko/`, `es/`, `fr/`, `de/`, `pt-BR/`
et `it/`. Passez `--lang en` (répétable) pour ne construire que certaines
langues. Une seule langue peut aussi être construite directement, par exemple
`DOCS_LANG=ja uv run --only-group docs sphinx-build -n -W --keep-going -b html docs docs/_build/html/ja`.

Les sources anglaises sont `docs/*.md`. Les traductions se trouvent dans
`docs/i18n/<language>/` avec les mêmes noms de fichiers ; une traduction
manquante fait échouer la construction au lieu de revenir à l'anglais. Les
blocs de code, commandes CLI, JSON et ancres doivent rester identiques à la
source anglaise ; `docs/verify_i18n.py` le vérifie, ainsi que le site
construit.

Ouvrez `docs/_build/html/index.html`, ou servez `docs/_build/html` avec
`python -m http.server` pour essayer le sélecteur de langue. Le site est
déployé sur GitHub Pages par `.github/workflows/docs.yml` lors des pushs sur
`main`.
