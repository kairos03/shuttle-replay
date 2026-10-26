# 開発

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

## このドキュメントのビルド

ドキュメントには Sphinx、Furo、MyST を使用しています。これらの依存関係は `docs` 依存グループにあり、実行時の依存関係ではありません。

```bash
uv sync --locked --only-group docs
uv run --only-group docs python docs/build.py
uv run --only-group docs python docs/verify_i18n.py
```

`docs/build.py` は `docs/_build/html` をクリーンアップし、言語ごとに厳格な Sphinx ビルド（`-n -W --keep-going`）を 1 回ずつ実行します。英語はルートに、その他の 9 言語は `zh/`、`ja/`、`ru/`、`ko/`、`es/`、`fr/`、`de/`、`pt-BR/`、`it/` の下に出力されます。一部の言語だけをビルドするには `--lang en` を指定します（複数回指定可能）。単一の言語を直接ビルドすることもできます。たとえば `DOCS_LANG=ja uv run --only-group docs sphinx-build -n -W --keep-going -b html docs docs/_build/html/ja` です。

英語のソースは `docs/*.md` です。翻訳は同じファイル名で `docs/i18n/<language>/` に置かれます。翻訳が欠けているとビルドは英語にフォールバックせずに失敗します。コードブロック、CLI コマンド、JSON、アンカーは英語のソースと同一でなければなりません。`docs/verify_i18n.py` がこれとビルドされたサイトを確認します。

言語セレクターを試すには、`docs/_build/html/index.html` を開くか、`python -m http.server` で `docs/_build/html` を配信してください。サイトは `main` へのプッシュ時に `.github/workflows/docs.yml` によって GitHub Pages にデプロイされます。
