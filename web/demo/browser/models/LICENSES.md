# Browser model files

Both files are run locally in the visitor's browser by onnxruntime-web; no video is
uploaded. Hashes and export details: `manifest.json`.

## tracknet.onnx — TrackNetV3 (MIT)

ONNX export (weights only, fp32, opset 17) of `TrackNet_best.pt` from the upstream
TrackNetV3 `ckpts.zip` (sha256 df867641a02712b021f04548ff4b1208ddfdb47f629ab2094ceb978667e83b1a),
https://github.com/qaz812345/TrackNetV3 revision 6eda442ada1740573f200f836d93edc9a541ee86.
The upstream license explicitly covers the pretrained checkpoints:

```
MIT License

Copyright (c) 2024 qaz812345

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software, pretrained model checkpoints, and associated documentation
files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom
the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## player-pose.onnx — Ultralytics YOLO11s-pose (AGPL-3.0)

ONNX export (ultralytics 8.4.190, imgsz 1280, opset 17, fp32) of `yolo11s-pose.pt`
(sha256 1060bda4a27012060eca246f9b2adeea22eabb045a1e58f8d229be29b7ebc2ba),
https://github.com/ultralytics/ultralytics . Ultralytics models are licensed under
AGPL-3.0 (https://github.com/ultralytics/ultralytics/blob/main/LICENSE) or an
Ultralytics Enterprise License (https://www.ultralytics.com/license). This project is
distributed under AGPL-3.0-only (repository `LICENSE`), whose full text applies to this
model file; the corresponding source is this repository.
