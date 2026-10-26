# レンダリングと出力の安全性

レンダラーはリプレイ MP4 を作ります。左に元のフレーム、右に真上から見たコートを置きます。レンダラーには、描画そのものと同じくらい重要な 2 つの仕事があります。元動画のタイミングをそのまま保つこと、そしてファイルを壊したり上書きしたりしないことです。このページの内容はすべて [`render.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py) にあります。

## デコード、描画、エンコード

PyAV は Python プロセス内で FFmpeg ライブラリをラップします。レンダラーは元動画を開き、最初の映像ストリームと、存在すれば最初の音声ストリームを取得し、ファイル順にパケットをデマルチプレクスします([`render`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L128-L279))。

```{figure} assets/technical/ja/render-pipeline.svg
:alt: レンダーパイプライン：source.mp4 をデマックスし、映像パケットをフレーム k にデコード、検査、描画して staging.mp4 にエンコード、音声パケットはコピー
:class: technical-figure
:width: 100%

ソースパケットからステージングファイルまでのフレームごとの経路。
```

デコードされたすべての映像フレーム `k` について、描画の前に次を確認します。

- 解析にフレーム `k` が存在し、その `frame_id` が `k` に等しいこと、
- デコードされたフレームに PTS があること、
- デコードされた時刻と解析の `pts_s` の差が最大 `1e-3` s であること。

いずれかが失敗すると、該当フレームを示す `RenderError` が送出されます。最後のパケットの後、デコードされたフレーム数は解析フレーム数と等しくなければなりません。

エンコードは、ローカルの FFmpeg ビルドが開けるものを基準に `libx264`、`h264`、`mpeg4` の順で試し、ピクセル形式は `yuv420p` です([`_open_encoder`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L77-L90))。エンコーダーは元の映像の `time_base` を使います。`mpeg4` で `time_base` の分母が 65535 を超える場合に限り、1/60000 s に切り替えます。各出力フレームには、元フレームの時刻をその `time_base` に変換した値が与えられるため、可変フレームレートは可変のまま保たれます。ストリーム作成時に渡す `rate=30` は名目上の値であり、フレーム時刻は元動画から来ます。

出力映像のタイムスタンプはエンコーダーのティック単位に丸められます。検証は出力フレーム数を確認しますが、デコードした出力映像の PTS をすべて元動画と比較するわけではありません。音声の検証は、パケットの表示時刻と、最初にデコードされた A/V オフセットを比較します([ソース](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L213-L242))。

## レイアウト

```{figure} assets/technical/ja/render-layout.svg
:alt: 出力レイアウト 6:4：左は等倍のソースフレーム（W x H）、右はコートを幅 4/6 W に収めた上面図
:class: technical-figure
:width: 100%

出力フレーム：ソースパネルと上面図の幅の比は 6:4。
```

`W` と `H` は、元動画の幅と高さを偶数に切り上げた値です(H.264 は偶数のサイズが必要です)。真上から見た画面の幅は `2 * round(W * 4 / 6 / 2)` です。元フレームは倍率 1.0 で左上隅に貼り付けられ、切り上げによって追加される黒いピクセルの行または列は最大 1 つです。真上から見た画面([`TopView`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L49-L69))は、6.10 x 13.40 m のコートを余白付きでパネルに収まるよう縮小し、コートの縦横比を保ちます。

Pillow がオーバーレイを描画します([`_compose`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L282-L336))。

- 緑のリング: ユーザーの検出(`shuttle_observed_px`);
- オレンジのリング: モデルの投影(`shuttle_model_px`);
- トラックに含まれていれば選手のボックス;
- 真上から見た画面: コートのライン、ネット、現在の飛行のモデル軌跡、モデルの高さに応じて大きくなる点、`z`、そしておおまかなモデル速度;
- 着地する飛行: 確認済みの領域を破線の矩形で示し、着地時刻以降はモデルの着地点にオレンジの十字を表示。

カメラ切り替えのフレームには "camera cut: excluded from replay" が表示され、シャトルのオーバーレイはありません。合成入力の場合は、真上から見た画面のタイトルに `SYNTHETIC` が付きます。

## 音声: 再エンコードではなくストリームコピー

音声はデコードも再エンコードもしません。各音声パケットは元のタイムスタンプのまま新しいコンテナにコピーされます(`add_stream_from_template` の後に `mux`)。DTS のないパケットはスキップされます。これにより、元動画の音声開始オフセットや途切れがそのまま保たれます。実際のファイルでは音声が映像より数分の 1 秒遅れて始まることがよくあるため、これは重要です。

ストリームコピーは、MP4 が元の音声コーデックを受け入れる場合にのみ機能します。ストリームを作成できない、またはパケットを多重化できない場合、レンダリングはストリームコピーの失敗を説明する `RenderError` で失敗します。ストリーム作成時のエラーにはコーデックが含まれます。再エンコードへのフォールバックはないため、すべての音声形式がサポートされるわけではありません。音声のない元動画からは無音の MP4 が作られ、`"source has no audio stream; output is silent"` として報告されます。

## 公開前の検証

レンダラーはステージングファイルに書き込み、出力パスに何かが現れる前にそれを検査します。

1. [`verify_mp4`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L339-L361) はステージングファイルを最後までデコードします。デコードされた映像フレーム数は、解析フレーム数と等しくなければなりません。
2. 音声がある場合、最初の音声時刻から最初の映像時刻を引いた値が、`1e-3` s 以内で元動画と一致しなければなりません([`_first_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L104-L117))。
3. 音声パケットの時刻リストが元動画と同一でなければなりません([`_audio_packet_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L120-L125))。

レンダーレポートはこれらの結果を記録します。`pts_check.max_abs_diff_s`、`audio.av_offset_error_s`、`audio.packets_copied`、そして `verification` の件数です。

## 上書きしない出力

作業を始める前に、[`_check_paths`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L93-L101) は、存在しない元動画、元動画に解決される出力(元動画へのシンボリックリンクやハードリンクを含む)、そしてすでに存在するあらゆる出力パス(リンク切れのシンボリックリンクも含む)を拒否します。何も上書きされることはありません。

ステージングファイルは、出力ディレクトリ内に `tempfile.mkstemp` によって `.<stem>.<random>.staging.mp4` という形式の一意な名前で作られます。検証後、`os.link` がそれへのハードリンクとして出力を作成します。ハードリンクは対象の名前がすでに存在すると失敗するため、レンダリング中に現れたファイルを公開処理が置き換えることはできません。ステージング名は成功時も失敗時も `finally` ブロックで削除されるので、ディレクトリ内の無関係なファイルに触れることはありません。この方式は、出力ディレクトリのファイルシステムがハードリンクをサポートしていることを前提としています。

CLI は JSON にも同じ規則を適用します。`_refuse_existing` はすべての出力パスを事前に確認し、`_dump` は排他的作成モードでファイルを開きます([`cli.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L34-L63))。`run` は 2 つの JSON ファイルを書き出す前に動画を公開するため、3 つの出力は 1 つのアトミックなトランザクションではありません。3 つの出力をすべて先に確認するので、たまたま `<out-dir>/analysis.json` に置かれていた入力ファイルは、上書きされずに拒否されます。ファイル名がシェルに渡ることはありません。テスト `test_render_rejects_mismatched_pts_and_handles_hostile_filename` は、シェルのメタ文字を含む名前からレンダリングします。

関連: `pts_s` については[観測とタイミング](observations-timing.md)、メディアチェックが証明することについては[検証と限界](validation-limits.md)、レンダーレポートについては[スキーマ](schemas.md)を参照してください。
