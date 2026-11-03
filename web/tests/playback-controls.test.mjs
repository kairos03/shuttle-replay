// SPDX-License-Identifier: AGPL-3.0-only
// Transport extras on the real app.js: time readout, playback speed and frame stepping
// along the analysis file's own pts_s (never a fixed frame rate).
import assert from "node:assert/strict";
import { test } from "node:test";

import { lookupFrame } from "../demo/js/analysis-model.js";
import { REAL_JSON, boot, key, pick, settle, tick, waitFor } from "./app-harness.mjs";

const REAL = { pts: JSON.parse(REAL_JSON).frames.map((f) => f.pts_s), nominalFrameS: 1 / 30 };

async function sample() {
  const env = await boot();
  const e = env.els;
  e["btn-sample"].click();
  await waitFor(() => e.video.getAttribute("src") === "assets/real/source_clip.mp4" && !e["btn-play"].disabled);
  return env;
}

test("speed and time readout stay off until a source is chosen", async () => {
  const env = await boot();
  await settle();
  assert.equal(env.els["sel-speed"].disabled, true);
  assert.equal(env.els["time-readout"].text, "0:00.00 / 0:00.00");
});

test("time readout and slider value text show current / total", async () => {
  const env = await sample();
  const e = env.els;
  assert.equal(e["time-readout"].text, "0:00.00 / 0:07.00"); // total is the video length
  assert.equal(e["rng-time"].getAttribute("aria-valuetext"), e["time-readout"].text);
  e["rng-time"].value = "3.5";
  e["rng-time"].dispatch("input");
  assert.match(e["time-readout"].text, /^0:03\.50 \/ /);
});

test("speed applies now and survives the next source load", async () => {
  const env = await sample();
  const e = env.els;
  assert.equal(e["sel-speed"].disabled, false);
  e["sel-speed"].value = "0.25";
  e["sel-speed"].dispatch("change");
  assert.equal(e.video.playbackRate, 0.25);
  pick(e["in-video"], { name: "next.mov" });
  await waitFor(() => /^blob:/.test(e.video.getAttribute("src") || ""));
  assert.equal(e.video.playbackRate, 0.25);
  assert.equal(e["sel-speed"].disabled, true); // analysing the new pick
});

test("arrow and comma/period keys pause and step one analysis frame, clamped at the ends", async () => {
  const env = await sample();
  const e = env.els;
  const frameAt = () => lookupFrame(REAL, e.video.currentTime).index;
  e.video.paused = false;
  key(env, "ArrowRight");
  assert.equal(e.video.paused, true);
  assert.equal(frameAt(), 1);
  key(env, ".");
  assert.equal(frameAt(), 2);
  key(env, ",");
  key(env, "ArrowLeft");
  key(env, "ArrowLeft");
  assert.equal(frameAt(), 0);
  const last = REAL.pts.length - 1;
  e.video.currentTime = REAL.pts[last];
  key(env, "ArrowRight");
  assert.equal(frameAt(), last);
});

test("past the analysed span only the key pointing back moves, onto the last frame", async () => {
  const env = await sample();
  const e = env.els;
  e.video.currentTime = REAL.pts.at(-1) + 0.5;
  key(env, "ArrowRight");
  assert.equal(e.video.currentTime, REAL.pts.at(-1) + 0.5);
  key(env, "ArrowLeft");
  assert.equal(lookupFrame(REAL, e.video.currentTime).index, REAL.pts.length - 1);
});

test("frame keys work with the play button or the timeline focused; Space on a button is left to it", async () => {
  const env = await sample();
  const e = env.els;
  e["btn-play"].tagName = "BUTTON";
  e["rng-time"].tagName = "INPUT";
  key(env, "ArrowRight", e["btn-play"]);
  assert.equal(lookupFrame(REAL, e.video.currentTime).index, 1);
  key(env, "ArrowRight", e["rng-time"]);
  assert.equal(lookupFrame(REAL, e.video.currentTime).index, 2);
  assert.equal(e["rng-time"].value, String(e.video.currentTime)); // the focused slider follows the step
  key(env, " ", e["btn-play"]);
  assert.equal(e.video.played, 0);
  key(env, "ArrowRight", { tagName: "INPUT" }); // any other input keeps its own keys
  assert.equal(lookupFrame(REAL, e.video.currentTime).index, 2);
});

test("no stepping while a picked video is being analysed", async () => {
  const env = await sample();
  const e = env.els;
  pick(e["in-video"], { name: "next.mov" });
  await waitFor(() => env.workers.length === 1);
  e.video.currentTime = 0.5;
  key(env, "ArrowRight");
  assert.equal(e.video.currentTime, 0.5);
});

test("a picked video without analysis frames has nothing to step", async () => {
  const env = await boot();
  const e = env.els;
  pick(e["in-video-first"], { name: "mine.mov" });
  await waitFor(() => env.workers.length === 1);
  env.workers[0].emit({ type: "failed", error: { code: "unsupported_codec", message: "코덱 미지원." } });
  await waitFor(() => !e["btn-play"].disabled);
  e.video.currentTime = 1.234;
  key(env, "ArrowRight");
  assert.equal(e.video.currentTime, 1.234);
});

test("repeat button and L key mark the span, show it under the timeline, repeat at the end, and reset per source", async () => {
  const env = await sample();
  const e = env.els;
  const btn = e["btn-loop"];
  assert.equal(btn.disabled, false);
  assert.equal(e["loop-band"].hidden, true);
  e.video.currentTime = 1;
  btn.click();
  assert.equal(btn.textContent, "끝 지점 찍기");
  assert.equal(btn.dataset.state, "start");
  assert.equal(e["loop-band"].hidden, false);
  e.video.currentTime = 3;
  key(env, "ㅣ", undefined, "KeyL"); // L on a Korean layout: the physical key counts
  assert.equal(btn.textContent, "반복 해제");
  assert.equal(btn.dataset.state, "repeat");
  assert.equal(btn.getAttribute("aria-label"), "구간 반복 중 0:01.00부터 0:03.00까지, 누르면 해제");
  const frac = (t) => ((t - REAL.pts[0]) / (REAL.pts.at(-1) - REAL.pts[0])).toFixed(5);
  assert.equal(e["loop-band"].style.left, `calc(8px + (100% - 16px) * ${frac(1)})`);
  assert.equal(e["loop-band"].style.width, `calc((100% - 16px) * ${(frac(3) - frac(1)).toFixed(5)})`);
  // Reaching the end of the clip with an end mark at the very end restarts at the start mark.
  const played = e.video.played;
  e.video.currentTime = 7;
  e.video.dispatch("ended");
  assert.equal(e.video.currentTime, 1);
  assert.equal(e.video.played, played + 1);
  key(env, "L", { tagName: "INPUT" }); // typing in another input never toggles it
  assert.equal(btn.textContent, "반복 해제");
  e["rng-time"].tagName = "INPUT";
  key(env, "l", e["rng-time"]); // the focused timeline does: drag there, then mark
  assert.equal(btn.textContent, "구간 반복");
  e.video.currentTime = 1;
  key(env, "l", e["rng-time"]);
  e.video.currentTime = 3;
  key(env, "l", e["rng-time"]);
  assert.equal(btn.textContent, "반복 해제");
  pick(e["in-video"], { name: "next.mov" });
  await waitFor(() => /^blob:/.test(e.video.getAttribute("src") || ""));
  assert.equal(btn.textContent, "구간 반복");
  assert.equal(e["loop-band"].hidden, true);
  assert.equal(btn.disabled, true); // analysing the new pick
});

test("while playing, the frame clock jumps back to the start mark at the end mark; paused, it does not", async () => {
  const env = await sample();
  const e = env.els;
  e.video.currentTime = 1;
  e["btn-loop"].click();
  e.video.currentTime = 3;
  e["btn-loop"].click();
  e.video.paused = false;
  e.video.dispatch("play"); // starts the clock
  e.video.currentTime = 2.5;
  tick(env);
  assert.equal(e.video.currentTime, 2.5); // inside the span: play on
  e.video.currentTime = 3.02;
  tick(env);
  assert.equal(e.video.currentTime, 1); // reached the end mark
  e.video.paused = true; // a tick already queued when the viewer paused
  e.video.currentTime = 3.02;
  tick(env);
  assert.equal(e.video.currentTime, 3.02);
});

test("without a repeat, the end of the clip just ends", async () => {
  const env = await sample();
  const e = env.els;
  const played = e.video.played;
  e.video.currentTime = 7;
  e.video.dispatch("ended");
  assert.equal(e.video.currentTime, 7);
  assert.equal(e.video.played, played);
});
