# 渲染与输出安全

渲染器生成一个回放 MP4：左侧是源帧，右侧是俯视球场。除了绘制本身，它还有两项同样重要的工作：保持源视频的时间不变，以及绝不损坏或覆盖任何文件。本页的所有内容都在 [`render.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py) 中。

## 解码、绘制、编码

PyAV 在 Python 进程内封装 FFmpeg 库。渲染器打开源文件，取第一个视频流以及（如果存在）第一个音频流，并按文件顺序解复用它们的数据包（[`render`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L128-L279)）。

```text
 source.mp4 --demux--> video packets --decode--> frame k --check--> draw --encode--> staging.mp4
                  \--> audio packets ----------------------------- copy ----------/
```

对每个解码出的视频帧 `k`，在绘制前检查：

- 分析结果中确实有第 `k` 帧，且其 `frame_id` 等于 `k`，
- 解码帧具有 PTS，并且
- 解码时间与分析中的 `pts_s` 相差最多 `1e-3` s。

任何一项失败都会抛出指明该帧的 `RenderError`。在最后一个数据包之后，解码帧数必须等于分析帧数。

编码依次尝试 `libx264`、`h264`、`mpeg4`，取本地 FFmpeg 构建能打开的那个，像素格式为 `yuv420p`（[`_open_encoder`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L77-L90)）。编码器使用源视频的 `time_base`；只有在使用 `mpeg4` 且 `time_base` 分母大于 65535 时，才回退到 1/60000 s。每个输出帧获得转换到该 `time_base` 的源帧时间，因此可变帧率保持可变。创建流时传入的 `rate=30` 只是名义值；帧时间来自源视频。

输出视频时间戳会舍入到编码器刻度。验证会检查输出帧数，但不会把每个解码后的输出视频 PTS 与源视频逐一比较。音频验证比较数据包显示时间和第一个解码出的 A/V 偏移（[源代码](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L213-L242)）。

## 布局

```text
 +--------------------------+------------------+
 |                          |  TOP VIEW        |
 |  source frame, unscaled  |  (court scaled   |
 |  W x H                   |   to fit, 4/6 W) |
 +--------------------------+------------------+
            6                        4
```

`W` 和 `H` 是源视频宽高向上取整到偶数的结果（H.264 需要偶数尺寸）；俯视图宽度为 `2 * round(W * 4 / 6 / 2)`。源帧以 1.0 的比例贴到左上角；向上取整最多增加一行或一列黑色像素。俯视图（[`TopView`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L49-L69)）把 6.10 x 13.40 m 的球场缩放到面板内并留出边距，同时保持球场比例。

Pillow 绘制叠加层（[`_compose`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L282-L336)）：

- 绿色圆环：你的检测（`shuttle_observed_px`）；
- 橙色圆环：模型的投影（`shuttle_model_px`）；
- 球员框，如果你的轨迹中包含；
- 俯视图：球场线、球网、当前飞行的模型轨迹线、大小随模型高度增大的圆点、`z` 以及粗略的模型速度；
- 落地飞行：以虚线矩形显示复核区域，并从落地时刻起在模型落点处显示橙色十字。

镜头切换帧显示 "camera cut: excluded from replay"，没有羽毛球叠加层。合成输入会在俯视图标题中加上 `SYNTHETIC`。

## 音频：流复制，而非重新编码

音频不会被解码和重新编码。每个音频数据包连同其原始时间戳被复制到新容器中（先 `add_stream_from_template`，再 `mux`）。没有 DTS 的数据包会被跳过。这样可以保留源视频的音频起始偏移和任何空隙；这很重要，因为真实文件中的音频常常比视频晚几分之一秒开始。

只有当 MP4 接受源音频编解码器时，流复制才可行。如果无法创建流或无法复用某个数据包，渲染会以描述流复制失败的 `RenderError` 失败；创建流时的错误会包含编解码器。没有回退到重新编码的路径，因此并非所有音频格式都受支持。没有音频的源会生成静音 MP4，并报告为 `"source has no audio stream; output is silent"`。

## 发布前的验证

渲染器先写入暂存文件，并在任何内容出现在你的输出路径之前检查它：

1. [`verify_mp4`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L339-L361) 完整解码暂存文件；解码出的视频帧数必须等于分析帧数。
2. 有音频时，第一个音频时间减去第一个视频时间必须在 `1e-3` s 内与源视频一致（[`_first_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L104-L117)）。
3. 音频数据包时间列表必须与源视频完全相同（[`_audio_packet_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L120-L125)）。

渲染报告记录这些结果：`pts_check.max_abs_diff_s`、`audio.av_offset_error_s`、`audio.packets_copied` 以及 `verification` 计数。

## 不覆盖的输出

在开始任何工作之前，[`_check_paths`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L93-L101) 会拒绝缺失的源文件、解析后指向源文件的输出（包括指向它的符号链接或硬链接），以及任何已经存在的输出路径，即使是悬空的符号链接。任何内容都不会被覆盖。

暂存文件由 `tempfile.mkstemp` 在输出目录中创建，名称唯一，形式为 `.<stem>.<random>.staging.mp4`。验证之后，`os.link` 把输出创建为指向它的硬链接。如果目标名称已存在，硬链接会失败，因此发布不会替换渲染期间出现的文件。无论成功还是失败，暂存名称都会在 `finally` 块中删除，因此目录中无关的文件永远不会被触碰。这依赖于输出目录所在的文件系统支持硬链接。

CLI 对 JSON 应用同样的规则：`_refuse_existing` 预先检查每个输出路径，`_dump` 以独占创建模式打开文件（[`cli.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L34-L63)）。`run` 在写入两个 JSON 文件之前发布视频，因此这三个输出不是一个原子事务。它会先检查全部三个输出，所以恰好位于 `<out-dir>/analysis.json` 的输入文件会被拒绝，而不是被覆盖。文件名从不传给 shell；测试 `test_render_rejects_mismatched_pts_and_handles_hostile_filename` 会从包含 shell 元字符的文件名进行渲染。

相关内容：`pts_s` 见[观测与时间](observations-timing.md)，媒体检查能证明什么见[验证与局限](validation-limits.md)，渲染报告见[数据格式](schemas.md)。
