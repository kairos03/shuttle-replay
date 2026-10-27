// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAnalysisText } from "../demo/js/analysis-model.js";
import { FrameClock } from "../demo/js/frame-clock.js";
import { PairLoader } from "../demo/js/pair-loader.js";
import { fixture } from "./helpers.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}

function harness() {
  const live = new Set();
  const revoked = [];
  const probes = new Map();
  let n = 0;
  const loader = new PairLoader({
    readText: async (file) => file.text,
    parse: parseAnalysisText,
    createURL: (file) => {
      const url = `blob:${file.name}#${++n}`;
      live.add(url);
      return url;
    },
    revokeURL: (url) => {
      live.delete(url);
      revoked.push(url);
    },
    probeVideo: (url) => {
      const d = deferred();
      probes.set(url.replace(/#\d+$/, ""), d);
      return d.promise;
    },
  });
  return { loader, live, revoked, probes };
}

const good = JSON.stringify(fixture());
const tick = () => new Promise((r) => setImmediate(r));

test("newest selection wins; superseded pair is released and never committed", async () => {
  const { loader, live, probes } = harness();
  const first = loader.apply({ video: { file: { name: "a.mp4" } }, analysis: { file: { text: good } } });
  await tick();
  const second = loader.apply({ video: { file: { name: "b.mp4" } }, analysis: { file: { text: good } } });
  await tick();
  probes.get("blob:b.mp4").resolve({ width: 640, height: 360, duration: 1 });
  probes.get("blob:a.mp4").resolve({ width: 640, height: 360, duration: 1 });
  assert.equal((await second).status, "committed");
  assert.equal((await first).status, "superseded");
  assert.match(loader.active.videoURL, /^blob:b\.mp4/);
  assert.deepEqual([...live], [loader.active.videoURL]);
});

test("invalid analysis or media failure keeps the active pair intact", async () => {
  const { loader, live, probes } = harness();
  const ok = loader.apply({ video: { url: "assets/sample.mp4" }, analysis: { text: good } });
  await tick();
  probes.get("assets/sample.mp4").resolve({ width: 640, height: 360, duration: 1 });
  assert.equal((await ok).status, "committed");
  const before = loader.active;

  const badJson = await loader.apply({ video: { file: { name: "c.mp4" } }, analysis: { file: { text: "{x" } } });
  assert.equal(badJson.status, "failed");
  assert.match(badJson.error.message, /JSON/);
  assert.equal(loader.active, before);

  const media = loader.apply({ video: { file: { name: "d.mkv" } }, analysis: { file: { text: good } } });
  await tick();
  probes.get("blob:d.mkv").reject(new Error("unsupported"));
  assert.equal((await media).status, "failed");
  assert.equal(loader.active, before);
  assert.equal(live.size, 0); // staged blob URL released; sample URL was never owned
});

test("replaced owned URL is revoked only after the new pair commits", async () => {
  const { loader, revoked, probes } = harness();
  const a = loader.apply({ video: { file: { name: "a.mp4" } }, analysis: { text: good } });
  await tick();
  probes.get("blob:a.mp4").resolve({ width: 1, height: 1, duration: 1 });
  await a;
  const oldURL = loader.active.videoURL;
  const b = loader.apply({ video: { url: "assets/sample.mp4" }, analysis: { text: good } });
  await tick();
  assert.deepEqual(revoked, []); // still staging: old pair still shown and alive
  probes.get("assets/sample.mp4").resolve({ width: 1, height: 1, duration: 1 });
  await b;
  assert.deepEqual(revoked, [oldURL]);
  loader.dispose();
  assert.equal(loader.active, null);
});

test("frame clock runs a single loop and cancels cleanly", () => {
  const pending = new Map();
  let id = 0;
  const video = {
    currentTime: 0.5,
    requestVideoFrameCallback(cb) {
      pending.set(++id, cb);
      return id;
    },
    cancelVideoFrameCallback(h) {
      pending.delete(h);
    },
  };
  const seen = [];
  const clock = new FrameClock(video, (t) => seen.push(t));
  clock.start();
  clock.start(); // no second loop
  assert.equal(pending.size, 1);
  const [h, cb] = [...pending][0];
  pending.delete(h);
  cb(0, { mediaTime: 1.2345 });
  assert.deepEqual(seen, [1.2345]);
  assert.equal(pending.size, 1);
  clock.stop();
  assert.equal(pending.size, 0);
});

test("frame clock falls back to requestAnimationFrame", () => {
  const frames = new Map();
  let id = 0;
  const win = {
    requestAnimationFrame: (cb) => (frames.set(++id, cb), id),
    cancelAnimationFrame: (h) => frames.delete(h),
  };
  const video = { currentTime: 2 };
  const seen = [];
  const clock = new FrameClock(video, (t) => seen.push(t), win);
  clock.start();
  const [h, cb] = [...frames][0];
  frames.delete(h);
  cb();
  assert.deepEqual(seen, [2]);
  clock.stop();
  assert.equal(frames.size, 0);
  assert.equal(clock.kind, "raf");
});
