# Technology overview

`shuttle-replay` turns three kinds of evidence into a replay: a local source
video, 2D shuttle detections that you supply, and constraints that a person has
reviewed (calibration points, contacts and landing regions). This page is the
map. The five pages after it explain each stage in depth, and every page links
to the exact source lines it describes, pinned to commit
`6e9a060b5cc964f02d4017d806e953ffea89c8b4`.

## Data flow

```{figure} assets/technical/en/pipeline.svg
:alt: Data flow: calibration, tracks and review feed analyze; video and analysis feed render, which writes the replay MP4 and a render report
:class: technical-figure
:width: 100%

Inputs and outputs of the three commands.
```

The CLI exposes each arrow as a command: `calibrate`, `analyze`, `render`, and
`run` (analyze + render in one step). `demo` builds a fully synthetic scene and
runs the same pipeline on it
([`cli.py` `build_parser`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L154-L191)).
In `run`, the video is rendered and verified before `analysis.json` and
`render_report.json` are written, so JSON results never describe a video that
failed
([`_run_pipeline`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L55-L63)).

What each stage adds:

1. **Calibration** turns reviewed pixel positions of known court points into a
   floor homography `H` and a 3x4 camera matrix `P` per camera segment. See
   [Camera calibration](camera-calibration.md).
2. **Input validation** checks timestamps, segments, contacts and flight ends,
   and rejects inconsistencies instead of repairing them. See
   [Observations and timing](observations-timing.md).
3. **Flight fitting** fits a gravity + quadratic-drag model to the 2D detections
   between reviewed contacts. See [Trajectory physics](trajectory-physics.md).
4. **Rendering** decodes the source, draws overlays and a top-view court,
   copies the audio packets and verifies the result before publishing it. See
   [Rendering and output safety](rendering-safety.md).
5. **Validation** is spread over all stages. What each check proves, and what
   it does not, is collected in [Validation and limits](validation-limits.md).

## Software stack

| Component | Role in this project |
| --- | --- |
| Python 3.12+ | Language; `requires-python = ">=3.12"` in `pyproject.toml` |
| NumPy | Linear algebra: homography DLT, SVD, projection, least-squares anchor solve |
| SciPy | `solve_ivp` integrates the flight ODE; `least_squares` fits flights |
| PyAV (`av`) | In-process FFmpeg bindings: decode, encode, audio stream copy, verification |
| Pillow | Draws rings, trails, the court and text onto each frame |
| uv | Installs the locked environment (`uv.lock`) and runs commands |
| Sphinx + MyST + Furo | Builds this documentation site (the `docs` dependency group) |

Runtime dependencies are exactly `numpy`, `scipy`, `av` and `pillow`
([`pyproject.toml`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/pyproject.toml#L10-L15)).
No subprocess or shell command is built from file names; video work goes
through PyAV in the same Python process
([`render.py` module docstring](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L1-L7)).

## Why there is no bundled model

Finding a shuttle in a frame (detection) and deciding where it is in 3D
(reconstruction) are separate problems. This project only does the second, and
only under explicit assumptions. There is no detector, no neural network and no
model weights to download. You bring detections from any tool you trust, in the
`shuttle-replay/tracks/v1` format described in [the schemas](schemas.md).

This keeps every number traceable. Each analysis frame labels its shuttle
position with a provenance layer
([`PROVENANCE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L33-L38)):

- `observed_pixel`: your detection, unchanged, or null when there was none.
- `human_review`: a contact, landing region or calibration point that a person
  entered.
- `conditional_model`: the fitted physics model, which is only as good as the
  calibration and review it is conditioned on.
- `display_interpolation`: lines the renderer draws between model samples.

A missed detection is never filled in as if it were observed, and the model is
never labelled as a measurement.

## Suggested reading route

If you are new to computer vision, read in this order:

1. [Camera calibration](camera-calibration.md): how pixels relate to metres,
   and why one camera cannot see depth on its own.
2. [Trajectory physics](trajectory-physics.md): how physics and reviewed
   contacts fill in the missing depth.
3. [Observations and timing](observations-timing.md): why timestamps come from
   the video container and not from a frame counter.
4. [Rendering and output safety](rendering-safety.md): how the MP4 is built and
   protected.
5. [Validation and limits](validation-limits.md): how to read the diagnostics
   and where they stop.

For hands-on steps, see [Getting started](getting-started.md),
[the user guide](guide.md) and [the workflow](workflow.md).
