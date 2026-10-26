# 技術概要

`shuttle-replay` は 3 種類の根拠をリプレイに変換します。ローカルの元動画、ユーザーが用意した 2D シャトル検出結果、そして人が確認した制約(キャリブレーション点、打球時点、着地領域)です。このページは全体の地図です。続く 5 つのページが各段階を詳しく説明し、どのページも説明対象のソースコードの正確な行にリンクしています。リンクはコミット `6e9a060b5cc964f02d4017d806e953ffea89c8b4` に固定されています。

## データの流れ

```{figure} assets/technical/ja/pipeline.svg
:alt: データフロー：キャリブレーション、トラック、レビューが analyze へ、動画と解析結果が render へ入り、リプレイ MP4 とレンダーレポートを出力
:class: technical-figure
:width: 100%

3 つのコマンドの入力と出力。
```

CLI は各矢印をコマンドとして提供します。`calibrate`、`analyze`、`render`、そして `run`(analyze と render を一度に実行)です。`demo` は完全に合成されたシーンを作り、その上で同じパイプラインを実行します([`cli.py` `build_parser`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L154-L191))。`run` では、`analysis.json` と `render_report.json` を書き出す前に動画をレンダリングして検証します。そのため、JSON の結果が失敗した動画を記述することはありません([`_run_pipeline`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L55-L63))。

各段階が加えるもの:

1. **キャリブレーション**は、既知のコート点について確認済みのピクセル位置を、カメラ区間ごとの床面ホモグラフィ `H` と 3x4 カメラ行列 `P` に変換します。[カメラキャリブレーション](camera-calibration.md)を参照してください。
2. **入力検証**は、タイムスタンプ、区間、打球時点、飛行の終わりを確認し、不整合を修復せずに拒否します。[観測とタイミング](observations-timing.md)を参照してください。
3. **飛行フィッティング**は、確認済みの打球時点の間にある 2D 検出結果に、重力と二次空気抵抗のモデルを当てはめます。[軌道の物理](trajectory-physics.md)を参照してください。
4. **レンダリング**は、元動画をデコードし、オーバーレイと真上から見たコートを描き、音声パケットをコピーし、結果を公開する前に検証します。[レンダリングと出力の安全性](rendering-safety.md)を参照してください。
5. **検証**はすべての段階にまたがります。各チェックが何を証明し、何を証明しないかは[検証と限界](validation-limits.md)にまとめています。

## ソフトウェアスタック

| コンポーネント | このプロジェクトでの役割 |
| --- | --- |
| Python 3.12+ | 言語。`pyproject.toml` の `requires-python = ">=3.12"` |
| NumPy | 線形代数: ホモグラフィ DLT、SVD、投影、アンカーの最小二乗解 |
| SciPy | `solve_ivp` で飛行の ODE を積分し、`least_squares` で飛行をフィッティング |
| PyAV (`av`) | プロセス内の FFmpeg バインディング: デコード、エンコード、音声ストリームのコピー、検証 |
| Pillow | 各フレームにリング、軌跡、コート、テキストを描画 |
| uv | ロックされた環境(`uv.lock`)をインストールし、コマンドを実行 |
| Sphinx + MyST + Furo | このドキュメントサイトをビルド(`docs` 依存グループ) |

ランタイム依存はちょうど `numpy`、`scipy`、`av`、`pillow` です([`pyproject.toml`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/pyproject.toml#L10-L15))。ファイル名からサブプロセスやシェルコマンドを組み立てることはなく、動画処理は同じ Python プロセス内で PyAV を通して行われます([`render.py` モジュールの docstring](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L1-L7))。

## モデルを同梱しない理由

フレーム内でシャトルを見つけること(検出)と、それが 3D 空間のどこにあるかを決めること(復元)は別々の問題です。このプロジェクトが扱うのは後者だけで、それも明示的な仮定の下に限られます。検出器も、ニューラルネットワークも、ダウンロードするモデルの重みもありません。信頼できる任意のツールで得た検出結果を、[スキーマ](schemas.md)で説明する `shuttle-replay/tracks/v1` 形式で持ち込んでください。

これにより、すべての数値を追跡できます。各解析フレームは、シャトル位置に由来レイヤーのラベルを付けます([`PROVENANCE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L33-L38))。

- `observed_pixel`: ユーザーの検出結果をそのまま保持したもの。検出がなければ null です。
- `human_review`: 人が入力した打球時点、着地領域、キャリブレーション点。
- `conditional_model`: フィッティングされた物理モデル。その良さは、条件として与えたキャリブレーションと確認の良さを超えません。
- `display_interpolation`: レンダラーがモデルのサンプル間に描く線。

検出漏れが観測されたかのように埋められることはなく、モデルが測定値としてラベル付けされることもありません。

## おすすめの読む順序

コンピュータビジョンが初めてなら、次の順に読んでください。

1. [カメラキャリブレーション](camera-calibration.md): ピクセルがメートルとどう対応するか、そしてカメラ 1 台だけではなぜ奥行きが見えないのか。
2. [軌道の物理](trajectory-physics.md): 物理と確認済みの打球時点が、欠けている奥行きをどう補うか。
3. [観測とタイミング](observations-timing.md): タイムスタンプをなぜフレームカウンターではなく動画コンテナから取るのか。
4. [レンダリングと出力の安全性](rendering-safety.md): MP4 をどう作り、どう保護するか。
5. [検証と限界](validation-limits.md): 診断値の読み方と、その診断がどこまで有効か。

実際に手を動かす手順は、[はじめに](getting-started.md)、[ユーザーガイド](guide.md)、[ワークフロー](workflow.md)を参照してください。
