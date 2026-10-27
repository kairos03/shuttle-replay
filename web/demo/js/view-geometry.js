// SPDX-License-Identifier: AGPL-3.0-only
// Pure source-pixel -> display-canvas mapping matching CSS `object-fit: contain`.

import { inImage } from "./analysis-model.js";

/**
 * Uniform scale + centring of a vw x vh source inside a cw x ch box (letterbox/pillarbox).
 * Returns the content rect and `map([u, v]) -> [x, y]` in box pixels.
 */
export function containTransform(vw, vh, cw, ch) {
  const scale = vw > 0 && vh > 0 ? Math.min(cw / vw, ch / vh) : 0;
  const width = vw * scale;
  const height = vh * scale;
  const ox = (cw - width) / 2;
  const oy = (ch - height) / 2;
  return { scale, width, height, ox, oy, map: (p) => [ox + p[0] * scale, oy + p[1] * scale] };
}

/** Map trail points through `t`, splitting runs at missing or out-of-image points. */
export function mapTrailRuns(points, t, vw, vh) {
  const runs = [];
  let run = [];
  for (const p of points) {
    if (!p || !inImage(p, vw, vh)) {
      if (run.length) runs.push(run);
      run = [];
      continue;
    }
    run.push(t.map(p));
  }
  if (run.length) runs.push(run);
  return runs;
}
