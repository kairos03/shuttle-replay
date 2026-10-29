# Notices

shuttle-replay
Copyright (C) 2026 KAIROS03

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, version 3 only (SPDX: `AGPL-3.0-only`). See `LICENSE`.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE.

## Runtime dependencies (not vendored)

Installed from PyPI by `uv`; each keeps its own license:

- NumPy (BSD-3-Clause), SciPy (BSD-3-Clause), Pillow (MIT-CMU / HPND)
- PyAV (BSD-3-Clause). PyAV binary wheels bundle FFmpeg libraries (LGPL/GPL
  depending on build, including libx264 under GPL-2.0-or-later). See the PyAV
  project for the exact bundled licenses.

## Vendored browser demo runtime

- **mp4box.js 2.5.0** (`web/demo/browser/vendor/mp4box/`), ESM dist files from the
  npm package `mp4box@2.5.0` (https://github.com/gpac/mp4box.js), sourcemap comments
  removed; BSD-3-Clause, copy in `web/demo/browser/vendor/mp4box/LICENSE`. Used only
  to demux a user-selected MP4/MOV locally in the browser.
- Model weights and the onnxruntime-web / Pyodide runtimes under
  `web/demo/browser/models/`, `runtime/` and `py/runtime/` are documented by their
  `models/LICENSES.md`, `models/manifest.json`, `runtime/LICENSE` and `py/runtime/LICENSE`.

## Vendored documentation assets

- **MathJax 3.2.2** (`docs/_static/mathjax/tex-svg.js`), from the official npm
  package `mathjax@3.2.2` (https://github.com/mathjax/MathJax), unmodified;
  Apache License 2.0, copy in `docs/_static/mathjax/LICENSE`. Used only by the
  documentation site to render equations locally.

## Upstream tools referenced but not included

This repository contains no code, model definitions or weights from the
projects below. They are mentioned only as possible ways to produce the
detections this tool consumes.

- **TrackNetV3** (shuttlecock tracking), https://github.com/qaz812345/TrackNetV3 —
  MIT License; the upstream LICENSE states it covers the pretrained weights too:
  https://raw.githubusercontent.com/qaz812345/TrackNetV3/master/LICENSE
- **Ultralytics YOLO** (person/pose detection), https://github.com/ultralytics/ultralytics —
  AGPL-3.0 or Ultralytics Enterprise License: https://www.ultralytics.com/license

If you run those tools yourself, their licenses apply to that use and to their
outputs as stated by their authors.

## Real-video browser demo

`web/demo/assets/real/source_clip.mp4` is a 7.007-second excerpt (210 frames,
1080x1920, no audio) of Pexels video 35427619, “Intense Indoor Badminton Match
in Action”:
https://www.pexels.com/video/intense-indoor-badminton-match-in-action-35427619/

The footage is used under the Pexels License, not AGPL:
https://www.pexels.com/license/ . The source page and license were checked for
this publication. Pexels permits free use and modification; its restrictions
continue to apply. No endorsement by Pexels or the depicted people is implied.
This project is an analytical replay demo, not a stock-footage distribution service.

The accompanying analysis is precomputed experimental output. Neither the
manual player calibration nor the conditional shuttle map is independently
verified ground truth. No model code or weights are bundled.

## Court geometry

Court dimensions follow the BWF Laws of Badminton (outer boundary 6.10 m x 13.40 m,
40 mm lines drawn and calibrated at their centres, metres). No BWF
documents are reproduced.
