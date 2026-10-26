# 개발

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

## 이 문서 빌드하기

문서는 Sphinx, Furo, MyST를 사용합니다. 이 의존성은 `docs` 의존성 그룹에 있으며 런타임 의존성이 아닙니다.

```bash
uv sync --locked --only-group docs
uv run --only-group docs python docs/build.py
uv run --only-group docs python docs/verify_i18n.py
```

`docs/build.py`는 `docs/_build/html`을 정리한 뒤 언어마다 엄격한 Sphinx 빌드(`-n -W --keep-going`)를 한 번씩 실행합니다. 영어는 루트에, 나머지 아홉 개 언어는 `zh/`, `ja/`, `ru/`, `ko/`, `es/`, `fr/`, `de/`, `pt-BR/`, `it/` 아래에 만들어집니다. 일부 언어만 빌드하려면 `--lang en`을 넘기세요(여러 번 지정 가능). 단일 언어를 직접 빌드할 수도 있습니다. 예: `DOCS_LANG=ja uv run --only-group docs sphinx-build -n -W --keep-going -b html docs docs/_build/html/ja`.

영어 원본은 `docs/*.md`입니다. 번역은 같은 파일 이름으로 `docs/i18n/<language>/`에 있습니다. 번역이 빠져 있으면 영어로 대체하지 않고 빌드가 실패합니다. 코드 블록, CLI 명령, JSON, 앵커는 영어 원본과 같아야 하며, `docs/verify_i18n.py`가 이것과 빌드된 사이트를 검사합니다.

언어 선택기를 시험해 보려면 `docs/_build/html/index.html`을 열거나 `python -m http.server`로 `docs/_build/html`을 띄우세요. 사이트는 `main`에 푸시할 때 `.github/workflows/docs.yml`이 GitHub Pages에 배포합니다.
