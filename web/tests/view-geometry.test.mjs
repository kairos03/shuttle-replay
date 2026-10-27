// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";

import { containTransform, mapTrailRuns } from "../demo/js/view-geometry.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("16:9 source in 16:9 box: identity-like uniform scale, no offsets", () => {
  const t = containTransform(1280, 720, 1600, 900);
  close(t.scale, 1.25);
  close(t.ox, 0);
  close(t.oy, 0);
  assert.deepEqual(t.map([1280, 720]), [1600, 900]);
});

test("portrait 1080x1920 in 16:9 box: pillarbox, uniform scale, centred", () => {
  const t = containTransform(1080, 1920, 1600, 900);
  close(t.scale, 900 / 1920);
  close(t.width, 1080 * (900 / 1920));
  close(t.height, 900);
  close(t.ox, (1600 - t.width) / 2);
  close(t.oy, 0);
  const [x0, y0] = t.map([0, 0]);
  const [x1, y1] = t.map([1080, 1920]);
  close(x0, t.ox);
  close(y0, 0);
  close(x1, t.ox + t.width);
  close(y1, 900);
  // aspect preserved: horizontal and vertical source distances scale equally
  const [ax, ay] = t.map([100, 100]);
  const [bx, by] = t.map([200, 200]);
  close(bx - ax, by - ay);
  // every in-image point lands inside the content rect, never in the pillarbox
  for (const p of [[0, 960], [1080, 960], [540, 0], [540, 1920]]) {
    const [x] = t.map(p);
    assert.ok(x >= t.ox - 1e-9 && x <= t.ox + t.width + 1e-9);
  }
});

test("wider-than-16:9 source (2.4:1) in 16:9 box: letterbox top/bottom", () => {
  const t = containTransform(2400, 1000, 1600, 900);
  close(t.scale, 1600 / 2400);
  close(t.ox, 0);
  close(t.oy, (900 - 1000 * t.scale) / 2);
  assert.ok(t.oy > 0);
  close(t.map([1200, 500])[1], 450);
});

test("resize / DPR: transform follows canvas backing size proportionally", () => {
  const css = containTransform(1080, 1920, 800, 450);
  const dpr2 = containTransform(1080, 1920, 1600, 900);
  const p = [700, 1300];
  close(dpr2.map(p)[0], css.map(p)[0] * 2);
  close(dpr2.map(p)[1], css.map(p)[1] * 2);
});

test("degenerate sizes do not produce NaN", () => {
  const t = containTransform(0, 0, 100, 100);
  assert.ok(Number.isFinite(t.scale) && Number.isFinite(t.ox) && Number.isFinite(t.oy));
});

test("trail runs use the same mapping as the ring and split at out-of-image points", () => {
  const t = containTransform(1080, 1920, 1600, 900);
  const pts = [[100, 100], [200, 300], null, [300, 400], [5000, 10], [400, 500], [410, 520]];
  const runs = mapTrailRuns(pts, t, 1080, 1920);
  assert.deepEqual(runs, [
    [t.map([100, 100]), t.map([200, 300])],
    [t.map([300, 400])],
    [t.map([400, 500]), t.map([410, 520])],
  ]);
  for (const run of runs) for (const [x] of run) assert.ok(x >= t.ox && x <= t.ox + t.width);
});
