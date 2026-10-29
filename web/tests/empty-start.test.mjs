// SPDX-License-Identifier: AGPL-3.0-only
// Empty first screen and lazy source choice, exercised on the real app.js with a tiny
// stand-in DOM: nothing loads until a choice, cancel/error keep the chooser, the sample
// keeps its analysis and a picked video is handed to a local analysis worker only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { boot, pick, settle, space, waitFor } from "./app-harness.mjs";

test("first visit is empty: no fetch, no video src, chooser shown, header actions and transport off", async () => {
  const env = await boot();
  await settle();
  const e = env.els;
  assert.deepEqual(env.fetches, []);
  assert.equal(e.video.getAttribute("src"), null);
  assert.equal(e.chooser.hidden, false);
  assert.equal(e["source-actions"].hidden, true);
  assert.equal(e["btn-play"].disabled, true);
  assert.equal(e["rng-time"].disabled, true);
  assert.equal(e["court-cue"].text, "");
  space(env);
  e["btn-play"].click();
  await settle();
  assert.equal(e.video.played, 0);
  assert.deepEqual(env.fetches, []);
});

test("cancel and undecodable first pick keep the empty chooser with a short error", async () => {
  const env = await boot();
  const e = env.els;
  pick(e["in-video-first"], null);
  await settle();
  assert.equal(e.chooser.hidden, false);
  assert.equal(e.video.getAttribute("src"), null);
  pick(e["in-video-first"], { name: "bad.mp4" });
  await waitFor(() => e["source-msg"].class_error === true);
  assert.equal(e.chooser.hidden, false);
  assert.equal(e["source-actions"].hidden, true);
  assert.equal(e.video.getAttribute("src"), null);
  assert.equal(e["btn-play"].disabled, true);
  assert.equal(e["source-msg"].class_error, true);
  assert.match(e["source-state"].text, /열 수 없습니다/);
  assert.equal(env.live.size, 0);
  assert.deepEqual(env.fetches, []);
});

test("own video whose analysis fails: blob only, no fetch, video playable; header sample switch restores analysis", async () => {
  const env = await boot();
  const e = env.els;
  pick(e["in-video-first"], { name: "<b>mine</b>.mov" });
  await waitFor(() => env.workers.length === 1);
  env.workers[0].emit({ type: "failed", error: { code: "unsupported_codec", message: "코덱 미지원." } });
  await waitFor(() => /자동 분석 실패/.test(e["source-state"].text));
  assert.deepEqual(env.fetches, []); // the file goes to a local worker, never over the network
  assert.equal(env.workers[0].terminated, true);
  assert.match(e.video.getAttribute("src"), /^blob:/);
  assert.equal(e.chooser.hidden, true);
  assert.equal(e["source-actions"].hidden, false);
  assert.equal(e["btn-play"].disabled, false);
  assert.equal(e["rng-time"].disabled, false);
  assert.equal(e["source-msg"].class_error, true);
  assert.match(e["source-state"].text, /코덱 미지원\. 영상만 재생합니다\.$/);
  assert.equal(e["source-name"].textContent, "<b>mine</b>.mov");
  assert.equal(e["court-cue"].text, "분석 결과 없음");
  assert.equal(e["btn-demo"].hidden, false);
  e["btn-demo"].click();
  await waitFor(() => e.video.getAttribute("src") === "assets/real/source_clip.mp4");
  assert.deepEqual(env.fetches, ["assets/real/analysis.json"]);
  assert.equal(e.video.getAttribute("src"), "assets/real/source_clip.mp4");
  assert.equal(e["court-cue"].text, "셔틀 위치 ≈ 추정");
  assert.equal(e["btn-demo"].hidden, true);
  assert.equal(env.live.size, 0);
});

test("sample choice loads the unchanged real pair once, with its analysis cue", async () => {
  const env = await boot();
  const e = env.els;
  e["btn-sample"].click();
  await waitFor(() => e.video.getAttribute("src") === "assets/real/source_clip.mp4");
  assert.deepEqual(env.fetches, ["assets/real/analysis.json"]);
  assert.equal(e.video.getAttribute("src"), "assets/real/source_clip.mp4");
  assert.equal(e.chooser.hidden, true);
  assert.equal(e["source-actions"].hidden, false);
  assert.equal(e["btn-play"].disabled, false);
  assert.equal(e["court-cue"].text, "셔틀 위치 ≈ 추정");
  assert.equal(e.video.played, 0); // no autoplay
});

test("rapid own pick then sample: sample wins, stale blob released", async () => {
  const env = await boot();
  const e = env.els;
  env.probeMode = "manual";
  pick(e["in-video-first"], { name: "slow.mp4" });
  await waitFor(() => env.pending.length === 1);
  e["btn-sample"].click();
  await waitFor(() => env.pending.length === 2);
  for (const p of env.pending.splice(0).reverse()) p.settle();
  await waitFor(() => e.video.getAttribute("src") === "assets/real/source_clip.mp4");
  assert.equal(e.video.getAttribute("src"), "assets/real/source_clip.mp4");
  assert.equal(e["court-cue"].text, "셔틀 위치 ≈ 추정");
  assert.equal(env.live.size, 0);
});

test("markup: chooser holds a native upload label and a sample button; no middle dots", () => {
  const html = readFileSync(new URL("../demo/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../demo/js/app.js", import.meta.url), "utf8");
  assert.match(html, /<label class="pick">영상 업로드\s*<input type="file" id="in-video-first" accept="video\/\*"/);
  assert.match(html, /<button type="button" id="btn-sample">샘플 보기<\/button>/);
  assert.ok(!/<video[^>]*\ssrc=/.test(html));
  assert.ok(!/·/.test(html + app));
});
