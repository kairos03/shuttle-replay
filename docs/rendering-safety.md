# Rendering and output safety

The renderer produces a replay MP4: the source frame on the left and a top-view
court on the right. It has two jobs that matter as much as the drawing itself:
keep the source timing intact, and never damage or overwrite a file. Everything
on this page is in
[`render.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py).

## Decode, draw, encode

PyAV wraps the FFmpeg libraries inside the Python process. The renderer opens
the source, takes the first video stream and, if present, the first audio
stream, and demuxes their packets in file order
([`render`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L128-L279)).

```{figure} assets/technical/en/render-pipeline.svg
:alt: Render pipeline: source.mp4 is demuxed; video packets are decoded to frame k, checked, drawn and encoded to staging.mp4; audio packets are copied
:class: technical-figure
:width: 100%

Per-frame path from source packets to the staging file.
```

For every decoded video frame `k`, before drawing, it checks that:

- the analysis has a frame `k` at all, and its `frame_id` equals `k`,
- the decoded frame has a PTS, and
- the decoded time differs from the analysis `pts_s` by at most `1e-3` s.

Any failure raises `RenderError`, naming the frame. After the last packet, the
number of decoded frames must equal the number of analysis frames.

Encoding tries `libx264`, then `h264`, then `mpeg4`, whichever the local FFmpeg
build can open, with pixel format `yuv420p`
([`_open_encoder`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L77-L90)).
The encoder uses the source video `time_base`; only for `mpeg4` with a
`time_base` denominator above 65535 does it fall back to 1/60000 s. Each output
frame gets the source frame's time converted to that `time_base`, so a
variable frame rate stays variable. The `rate=30` passed when the stream is
created is a nominal value; frame times come from the source.

Output video timestamps are rounded to encoder ticks. Verification checks
output frame count, but does not compare every decoded output video PTS with
the source. Audio verification compares packet presentation times and the first
decoded A/V offset
([source](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L213-L242)).

## Layout

```{figure} assets/technical/en/render-layout.svg
:alt: Output layout 6:4: left, the source frame unscaled (W x H); right, the top view with the court scaled to fit a width of 4/6 W
:class: technical-figure
:width: 100%

Output frame: source panel and top view in a 6:4 width ratio.
```

`W` and `H` are the source width and height rounded up to even numbers (H.264
needs even sizes); the top-view width is `2 * round(W * 4 / 6 / 2)`. The source
frame is pasted at scale 1.0 into the top-left corner; rounding up adds at most
one black pixel row or column. The top view
([`TopView`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L49-L69))
scales the 6.10 x 13.40 m court to fit its panel with a margin and keeps the
court's proportions.

Pillow draws the overlays
([`_compose`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L282-L336)):

- green ring: your detection (`shuttle_observed_px`);
- orange ring: the model's projection (`shuttle_model_px`);
- player boxes, if your tracks contain them;
- top view: court lines, the net, the model trail of the current flight, a dot
  whose size grows with model height, `z` and the coarse model speed;
- landing flights: the reviewed region as a dashed rectangle and, from the
  landing time on, an orange cross at the model landing point.

Camera-cut frames show "camera cut: excluded from replay" and no shuttle
overlay. Synthetic inputs add `SYNTHETIC` to the top-view title.

## Audio: stream copy, not re-encode

Audio is not decoded and re-encoded. Each audio packet is copied into the new
container with its original timestamps (`add_stream_from_template`, then
`mux`). Packets without a DTS are skipped. This keeps the source's audio start
offset and any gaps, which matters because real files often start audio a
fraction of a second after video.

Stream copy only works if MP4 accepts the source audio codec. If the stream
cannot be created or a packet cannot be muxed, rendering fails with a
`RenderError` describing the stream-copy failure; stream-creation errors
include the codec. There is no fallback to re-encoding, so not
every audio format is supported. A source with no audio produces a silent MP4,
reported as `"source has no audio stream; output is silent"`.

## Verification before publication

The renderer writes to a staging file and checks it before anything appears at
your output path:

1. [`verify_mp4`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L339-L361)
   fully decodes the staging file; the decoded video frame count must equal the
   analysis frame count.
2. With audio, the first audio time minus the first video time must match the
   source within `1e-3` s
   ([`_first_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L104-L117)).
3. The list of audio packet times must be identical to the source's
   ([`_audio_packet_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L120-L125)).

The render report records these results: `pts_check.max_abs_diff_s`,
`audio.av_offset_error_s`, `audio.packets_copied` and the `verification`
counts.

## No-clobber output

Before any work,
[`_check_paths`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L93-L101)
refuses a missing source, an output that resolves to the source (including a
symlink or a hard link to it), and any output path that already exists, even a
dangling symlink. Nothing is ever overwritten.

The staging file is created by `tempfile.mkstemp` in the output directory with
a unique name of the form `.<stem>.<random>.staging.mp4`. After verification,
`os.link` creates the output as a hard link to it. A hard link fails if the
target name exists, so publication cannot replace a file that appeared during
rendering. The staging name is removed in a `finally` block on success and on
failure, so an unrelated file in the directory is never touched. This relies on
the output directory's file system supporting hard links.

The CLI applies the same rule to JSON: `_refuse_existing` checks every output
path up front, and `_dump` opens files in exclusive-create mode
([`cli.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L34-L63)).
`run` publishes the video before writing the two JSON files, so the three
outputs are not one atomic transaction. It checks all three outputs first, so a supplied input that happens to sit at
`<out-dir>/analysis.json` is refused rather than overwritten. File names never
reach a shell; the test
`test_render_rejects_mismatched_pts_and_handles_hostile_filename` renders from a
name containing shell metacharacters.

Related: [Observations and timing](observations-timing.md) for `pts_s`,
[Validation and limits](validation-limits.md) for what the media checks prove,
[the schemas](schemas.md) for the render report.
