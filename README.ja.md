<p align="center">
  <img src="docs/assets/header.svg" alt="shuttle-replay" width="100%">
</p>

<p align="center"><b>ローカルのバドミントン動画、あなたの検出結果、あなたのレビューを、並べて見られるコートリプレイに変換します。オフラインで。</b></p>

<p align="center">
  <a href="https://github.com/kairos03/shuttle-replay/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/kairos03/shuttle-replay/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <img src="https://img.shields.io/badge/python-3.12%2B-3776ab?style=flat-square" alt="Python 3.12+">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-c6f04a?style=flat-square" alt="AGPL-3.0-only"></a>
  <img src="https://img.shields.io/badge/runs-offline-0d2a1f?style=flat-square" alt="Offline">
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ru.md">Русский</a> | <a href="README.ko.md">한국어</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.de.md">Deutsch</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.it.md">Italiano</a>
</p>

<p align="center">
  <a href="#quick-start">クイックスタート</a> |
  <a href="#workflow">ワークフロー</a> |
  <a href="docs/usage.ko.md">한국어 가이드（韓国語ガイド）</a> |
  <a href="docs/schemas.md">スキーマ（英語）</a>
</p>

## 概要

`shuttle-replay` は、あなたがレビューしたコート上の点からカメラをキャリブレーションし、
あなたが用意した 2D シャトル検出結果に重力 + 二次抗力の飛行モデルをフィットさせ、
元動画の横にコートの俯瞰図を並べた MP4 をレンダリングします。

これは研究とレビューのためのツールであり、ライン判定システム、ショット分類器、
シャトル検出器、3D 速度を実測するスピードガンではありません。すべての 3D 位置と速度は、
あなたのキャリブレーションとアノテーションに依存する条件付きモデル出力です。

## インストール

Python 3.12+ と [uv](https://docs.astral.sh/uv/) が必要です。

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

PyAV の wheel には FFmpeg が同梱されているため、システムの FFmpeg は不要です。

## 使う理由

- **完全オフライン。** 検出器もモデルの重みもネットワーク通信もありません。
- **人によるレビューが先。** 打点、着地領域、キャリブレーション点はあなたが決めます。黙って修正されるものはありません。
- **正直なレイヤー分け。** 観測ピクセル、あなたのレビュー、条件付きモデルは出力上で分けて保持されます。
- **安全なレンダリング。** 元の音声は再エンコードせずにストリームコピーされ、既存のファイルが上書きされることはありません。

<a id="quick-start"></a>
## クイックスタート

```bash
uv run shuttle-replay demo --out-dir demo
```

`demo/inputs/`（合成動画、トラック、レビュー、キャリブレーション入力）、
`demo/calibration.json`、`demo/analysis.json`、`demo/replay.mp4`、
`demo/render_report.json`、`demo/synthetic_recovery.json` を書き出します。

<p align="center">
  <img src="docs/assets/demo.gif" alt="合成デモのリプレイ：元映像の横にコートの俯瞰図" width="90%">
  <br><sub><code>demo</code> で生成した合成デモです。実環境での精度を示すものではありません。</sub>
</p>

<a id="workflow"></a>
## ワークフロー

自分の動画で使う場合に用意が必要なもの：

- **検出結果**（`tracks.json`）：デコードされたフレームごとに 1 エントリ。PTS、
  カメラセグメント id、シャトルのピクセルまたは null、任意の選手ボックスを含みます。
  検出器は内蔵されていません。
- **キャリブレーション入力**：セグメントごとに少なくとも 4 つの `fit` コート点、
  いくつかの `heldout` 点、両方のネットポストの頂点（1.55 m）。
- **レビュー**（`review.json`）：あなたがレビューした打点の時刻、ピクセル、高さと、
  任意の着地領域。打点は自動では検出されません。

```bash
uv run shuttle-replay calibrate calibration_input.json -o calibration.json
uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
    --calibration calibration.json --out-dir out
```

<details>
<summary><b>自分の動画で使うためのステップバイステップガイド</b></summary>

1. **検出結果。** デコードされたフレームごとに `tracks.json` のエントリを 1 つ作ります。
   フレームの PTS、カメラセグメント id（カット切り替えやクローズアップは null）、
   シャトルのピクセル（または null）、任意の選手ボックスを入れます。
   [docs/schemas.md](docs/schemas.md)（英語）を参照してください。トラッカーは何でも使えます。
   たとえば、シャトルには TrackNetV3（MIT）、選手には Ultralytics YOLO モデル（AGPL-3.0）を
   自分のチェックポイントで自分で実行し、その出力を変換できます。変換スクリプトは v0.1 には
   含まれていません。
2. **キャリブレーション入力。** カメラセグメントごとに、コートラインの交点を 4 つ以上
   （ロール `fit`）、さらにいくつかを `heldout` として、そして 2 本のネットポストの頂点
   （1.55 m）を測定します。

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   先に進む前に `heldout_summary` と `net_anchor_sensitivity` を確認してください。
3. **レビュー。** `review.json` を書きます。レビューした区間内の打点時刻、打点ピクセルと
   高さの事前値、そしてセグメント最後の飛行には任意の着地領域または `open` を入れます。
4. **解析とレンダリング。**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   入力に矛盾がある場合（単調増加でない PTS、連続しないセグメント、セグメントや区間の外にある
   打点、動画と一致しない PTS など）は、終了コード 2 とメッセージを出して停止します。
   黙って修正されるものはありません。

</details>

<details>
<summary><b>各コマンドの働き</b></summary>

- **キャリブレーション**（`calibrate`）：レビュー済みの床面の点 4 つ以上からホモグラフィを求め、
  高さのあるネットアンカー 2 つ以上からカメラの垂直列を求めます。ホールドアウトの床面点は
  フィットには一切使わず、別途（ピクセルとメートルで）報告します。縮退した入力、重複、
  共線、有限でない入力は拒否されます。床面ホモグラフィが空中の点に使われることはありません。
- **解析**（`analyze`）：レビューした打点ごとに 1 つの飛行を作り、最初の検出が遅れて現れても、
  レビューした打点（時刻ゼロ）から計時します。元の PTS、フレーム id、カメラセグメント id を
  使います。カメラのカット切り替えは除外され、飛行がセグメントをまたぐことはありません。
  各飛行は、次の打点（インターセプトされたもので、強制的に着地させない）、レビュー済みの
  着地領域（実測座標ではなく制約）、またはセグメント内の最後の観測で終わります。床面と
  ネットのゲートが実現不可能なフィットを拒否します。飛行がインターセプトされた場合、
  到達して*いたはず*の床面の点は反実仮想として別途報告されます。欠けている検出は null のままです。
- **レンダリング**（`render`）：デコードしたすべての元フレームをトラックの PTS と照合して検証し、
  提供された選手ボックス、観測されたシャトルのリング（緑）、モデルのリング（オレンジ）、
  そして元映像と俯瞰図を 6:4 で並べたレイアウトのコート俯瞰図を描画します。カメラの
  カット切り替えフレームにはシャトルのオーバーレイを描きません。元の音声パケットは変更なしで
  ストリームコピーされる（再エンコードなし）ため、元音声の開始オフセットと途切れは保持されます。
  音声を MP4 にコピーできない場合やタイミングが変わる場合、レンダリングは失敗します。
  ファイル名からシェルコマンドを組み立てることはありません。出力が上書きされることはありません。
  出力が既に存在するか元ファイルと同じものを指す場合はレンダリングが失敗し、一意の一時ファイルに
  書き込んで、完全なデコードチェックの後にのみ公開します。
- **デモ**（`demo`）：完全に合成されたラリー（仮想カメラ 2 台、カメラのカット切り替え 1 回、
  途切れのあるノイズ入り検出、テストトーン）を生成し、合成正解の復元レポートを含めて
  パイプライン全体を実行します。

</details>

<details>
<summary><b>出力の読み方</b></summary>

| レイヤー | 意味 |
| --- | --- |
| `observed_pixel` | 提供された検出結果そのまま。ない場合は null |
| `human_review` | あなたの打点、着地領域、キャリブレーション点 |
| `conditional_model` | あなたの事前値のもとで観測ピクセルにフィットさせた物理モデル |
| `display_interpolation` | レンダラーが描画するだけの線とマーカー |

速度はフィットしたモデルの初速です（`model_speed_km_h`、5 km/h 単位に丸めて表示）。
おおまかなモデル値として扱ってください。

</details>

<details>
<summary><b>制限事項</b></summary>

- シャトルや選手の検出はありません。検出結果は
  [tracks 形式](docs/schemas.md)（英語）であなたが用意します。モデルの重みはダウンロードされません。
- 打点の自動検出や打点タイムスタンプの精密化はありません。
- 学習済みの密な深度マップ、学習済みのショットラベル、自動 IN/OUT 判定はありません。
- 3D 出力は実測ではなく条件付きです。再投影誤差が小さいことは 2D 検出との整合性を示すだけで、
  3D 精度の独立した証明にはなりません。合成データでの復元結果は合成データについての結果です。

</details>

<details>
<summary><b>開発</b></summary>

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

</details>

<details>
<summary><b>ライセンス</b></summary>

GNU Affero General Public License v3.0 only（`AGPL-3.0-only`）。サードパーティーの表記については
[LICENSE](LICENSE) と [NOTICE.md](NOTICE.md) を参照してください。

</details>
