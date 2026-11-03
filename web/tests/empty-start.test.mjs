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

test("player name fields appear for the positions in the loaded result and reset for the next source", async () => {
  const env = await boot();
  const e = env.els;
  assert.equal(e.names.hidden, true);
  e["btn-sample"].click();
  await waitFor(() => e.video.getAttribute("src") === "assets/real/source_clip.mp4");
  assert.equal(e.names.hidden, false);
  const labels = e["names-fields"].children;
  assert.deepEqual(labels.map((l) => l.children[0]), [
    "N1 (카메라 쪽, 처음 왼쪽)", "N2 (카메라 쪽, 처음 오른쪽)", "F1 (먼 쪽, 처음 왼쪽)", "F2 (먼 쪽, 처음 오른쪽)",
  ]);
  assert.equal(e["btn-swap-sides"].hidden, false);
  const input = labels[0].children[1];
  assert.equal(input.placeholder, "N1");
  const video = e["cv-overlay"].drawn;
  const court = e["cv-court"].drawn;
  video.length = court.length = 0;
  input.value = "철수";
  input.dispatch("input"); // redraws with the name; nothing is stored or fetched
  assert.ok(video.includes("철수")); // the video label
  assert.ok(court.includes("철수")); // beside the court marker
  assert.ok(court.includes("N1")); // the marker keeps its short id
  assert.deepEqual(env.fetches, ["assets/real/analysis.json"]);
  const played = e.video.played;
  (env.docListeners.keydown || []).forEach((f) => f({ key: " ", target: { tagName: "SUMMARY" }, preventDefault() {} }));
  assert.equal(e.video.played, played); // Space on the 선수 이름 summary toggles it, not playback
  const fields = labels.map((l) => l.children[1]);
  fields[3].value = "지영";
  fields[3].dispatch("input");
  video.length = court.length = 0;
  e["btn-swap-sides"].click(); // change of ends: 철수 (N1) to F1, 지영 (F2) to N2
  assert.deepEqual(fields.map((f) => f.value), ["", "지영", "철수", ""]);
  assert.ok(court.includes("철수") && court.includes("지영"));
  e["btn-swap-sides"].click();
  assert.deepEqual(fields.map((f) => f.value), ["철수", "", "", "지영"]);
  pick(e["in-video"], { name: "mine.mov" });
  await waitFor(() => env.workers.length === 1);
  env.workers[0].emit({ type: "failed", error: { code: "unsupported_codec", message: "코덱 미지원." } });
  await waitFor(() => /^blob:/.test(e.video.getAttribute("src") || ""));
  assert.equal(e.names.hidden, true); // no players in a result-less video
  assert.deepEqual(e["names-fields"].children, []);
  e.names.open = true;
  e["btn-demo"].click(); // back to the sample: fresh, empty, collapsed
  await waitFor(() => e["names-fields"].children.length === 4);
  assert.equal(e.names.open, false);
  assert.deepEqual(e["names-fields"].children.map((l) => l.children[1].value), ["", "", "", ""]);
});
