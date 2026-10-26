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

## Court geometry

Court dimensions follow the BWF Laws of Badminton (outer boundary 6.10 m x 13.40 m,
40 mm lines drawn and calibrated at their centres, metres). No BWF
documents are reproduced.
