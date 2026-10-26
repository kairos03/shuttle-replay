# Desenvolvimento

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

## Gerando esta documentação

A documentação usa Sphinx, Furo e MyST. Suas dependências ficam no grupo de
dependências `docs` e não são dependências de execução.

```bash
uv sync --locked --only-group docs
uv run --only-group docs python docs/build.py
uv run --only-group docs python docs/verify_i18n.py
```

`docs/build.py` limpa `docs/_build/html` e executa um build estrito do Sphinx
(`-n -W --keep-going`) por idioma: inglês na raiz e os outros nove idiomas em
`zh/`, `ja/`, `ru/`, `ko/`, `es/`, `fr/`, `de/`, `pt-BR/` e `it/`. Passe
`--lang en` (repetível) para gerar apenas alguns idiomas. Um único idioma
também pode ser gerado diretamente, por exemplo
`DOCS_LANG=ja uv run --only-group docs sphinx-build -n -W --keep-going -b html docs docs/_build/html/ja`.

As fontes em inglês são `docs/*.md`. As traduções ficam em
`docs/i18n/<language>/` com os mesmos nomes de arquivo; uma tradução ausente
faz o build falhar em vez de recorrer ao inglês. Blocos de código, comandos da
CLI, JSON e âncoras devem permanecer idênticos à fonte em inglês;
`docs/verify_i18n.py` verifica isso e o site gerado.

Abra `docs/_build/html/index.html`, ou sirva `docs/_build/html` com
`python -m http.server` para testar o seletor de idioma. O site é publicado no
GitHub Pages por `.github/workflows/docs.yml` a cada push para `main`.
