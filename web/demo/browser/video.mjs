// SPDX-License-Identifier: AGPL-3.0-only
// Browser-local video access for automatic analysis: MP4/MOV demux (mp4box.js), WebCodecs
// decode, exact presentation timestamps from the container (edit list applied, so they match
// <video>.currentTime), camera-cut segments and the frame products the models and the court
// calibration consume. Pure helpers are exported for Node tests; nothing here uploads bytes.

import { createFile, DataStream, Endianness } from "./vendor/mp4box/mp4box.all.mjs";

export const LIMITS = Object.freeze({
  maxBytes: 512 * 1024 * 1024,
  maxDurationS: 30,
  maxFrames: 900,
  maxPixels: 3840 * 2160,
  minSegmentFrames: 8, // TrackNet window length; shorter shots are masked
});
export const TRACK_SIZE = Object.freeze({ width: 512, height: 288 });
export const THUMB_SIZE = Object.freeze({ width: 64, height: 36 });
export const POSE_MAX_SIDE = 1280; // R5 POSE_IMGSZ
export const CALIB_MAX_WIDTH = 1920; // R5 CALIB_MAX_W
export const CALIB_FRAMES = 25;
export const CUT_DISTANCE = 0.5; // half L1 distance between normalised colour histograms

export class AnalysisError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const abortError = () => new AnalysisError("cancelled", "분석이 취소되었습니다.");
export function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError();
}

// ---------- pure helpers ----------

/** Rotation (0/90/180/270) from a tkhd 3x3 fixed-point matrix [a,b,u,c,d,v,x,y,w]. */
export function matrixRotation(m) {
  if (!m) return 0;
  const a = m[0];
  const b = m[1];
  const deg = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  return ((deg % 360) + 360) % 360;
}

/**
 * Presentation timestamps (seconds) on the media-element timeline. `samples` are
 * {cts, duration} in media `timescale`; the first non-empty edit's media_time is subtracted
 * and leading empty edits (movie timescale) added, as browsers do for playback.
 * Returns { order: sample indices in presentation order, pts: seconds per presented frame }.
 */
export function presentationTimes(samples, timescale, edits = [], movieTimescale = 1000) {
  let empty = 0;
  let mediaTime = 0;
  for (const e of edits || []) {
    if (e.media_time === -1) empty += e.segment_duration / movieTimescale;
    else {
      mediaTime = e.media_time;
      break;
    }
  }
  const order = samples.map((_, i) => i).sort((i, j) => samples[i].cts - samples[j].cts);
  const pts = order.map((i) => Math.round(((samples[i].cts - mediaTime) / timescale + empty) * 1e6) / 1e6);
  return { order, pts };
}

/** Throws AnalysisError unless the pts are finite and strictly increasing. */
export function checkPts(pts) {
  for (let i = 0; i < pts.length; i++) {
    if (!Number.isFinite(pts[i])) throw new AnalysisError("bad_timestamps", "영상 타임스탬프가 올바르지 않습니다.");
    if (i > 0 && !(pts[i] > pts[i - 1])) throw new AnalysisError("bad_timestamps", "영상 타임스탬프가 겹칩니다.");
  }
}

/** Throws AnalysisError when the clip is outside the browser analysis bounds. */
export function checkLimits({ bytes, width, height, durationS, frames }) {
  if (bytes > LIMITS.maxBytes) throw new AnalysisError("too_large", `파일이 너무 큽니다 (최대 ${LIMITS.maxBytes >> 20}MB).`);
  if (!(width > 0 && height > 0)) throw new AnalysisError("no_video_track", "영상 트랙이 없습니다.");
  if (width * height > LIMITS.maxPixels) throw new AnalysisError("too_many_pixels", "해상도가 너무 큽니다 (최대 4K).");
  if (durationS > LIMITS.maxDurationS + 0.5) {
    throw new AnalysisError("too_long", `영상이 너무 깁니다 (${durationS.toFixed(1)}초, 최대 ${LIMITS.maxDurationS}초).`);
  }
  if (frames > LIMITS.maxFrames) throw new AnalysisError("too_many_frames", `프레임이 너무 많습니다 (최대 ${LIMITS.maxFrames}).`);
  if (frames < LIMITS.minSegmentFrames) throw new AnalysisError("too_short", "영상이 너무 짧습니다.");
}

/** 512-bin (8 levels per channel) normalised colour histogram of an RGB(A) buffer. */
export function colorHistogram(data, channels = 4) {
  const h = new Float64Array(512);
  const n = data.length / channels;
  for (let p = 0; p < data.length; p += channels) h[(data[p] >> 5) * 64 + (data[p + 1] >> 5) * 8 + (data[p + 2] >> 5)]++;
  for (let i = 0; i < 512; i++) h[i] /= n;
  return h;
}

/** Indices i where frame i starts a new shot (R5 video.detect_cuts). */
export function detectCuts(hists, threshold = CUT_DISTANCE) {
  const cuts = [];
  for (let i = 1; i < hists.length; i++) {
    let d = 0;
    for (let k = 0; k < 512; k++) d += Math.abs(hists[i][k] - hists[i - 1][k]);
    if (0.5 * d > threshold) cuts.push(i);
  }
  return cuts;
}

/** Half-open [a, b) shots; shots shorter than minLen are excluded (R5 segments_from_cuts). */
export function segmentsFromCuts(n, cuts, minLen = LIMITS.minSegmentFrames) {
  const bounds = [0, ...cuts, n];
  const segments = [];
  const excluded = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const [a, b] = [bounds[k], bounds[k + 1]];
    if (b - a >= minLen) segments.push([a, b]);
    else for (let i = a; i < b; i++) excluded.push(i);
  }
  return { segments, excluded };
}

/** Up to k evenly spaced frame indices covering [a, b) (first and last included). */
export function evenIndices(a, b, k = CALIB_FRAMES) {
  const n = b - a;
  if (n <= 0) return [];
  if (n <= k) return Array.from({ length: n }, (_, i) => a + i);
  const out = [];
  for (let i = 0; i < k; i++) out.push(a + Math.round((i * (n - 1)) / (k - 1)));
  return [...new Set(out)];
}

export function longestSegment(segments) {
  return segments.reduce((best, s) => (!best || s[1] - s[0] > best[1] - best[0] ? s : best), null);
}

/** Aspect-preserving size with the longest side at most maxSide (never upscaled). */
export function fitWithin(width, height, maxSide) {
  const s = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

export function fitWidth(width, height, maxWidth) {
  const s = Math.min(1, maxWidth / width);
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

export function rgbaToRgb(rgba) {
  const n = rgba.length >> 2;
  const out = new Uint8Array(n * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    out[j] = rgba[i];
    out[j + 1] = rgba[i + 1];
    out[j + 2] = rgba[i + 2];
  }
  return out;
}

// ---------- demux ----------

function codecDescription(trak) {
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8); // drop the box header
    }
  }
  return undefined;
}

/**
 * Demux the first video track of an MP4/MOV ArrayBuffer. Resolves
 * { codec, codedWidth, codedHeight, width, height, rotation, description, timescale,
 *   samples (decode order), order, pts, durationS }.
 */
export function demuxMp4(buffer) {
  return new Promise((resolve, reject) => {
    const file = createFile();
    let track = null;
    let trak = null;
    const samples = [];
    file.onError = (e) => reject(new AnalysisError("demux_failed", `MP4를 읽지 못했습니다 (${String(e).slice(0, 80)}).`));
    file.onReady = (info) => {
      track = info.videoTracks && info.videoTracks[0];
      if (!track) return reject(new AnalysisError("no_video_track", "영상 트랙이 없습니다."));
      trak = file.getTrackById(track.id);
      file.setExtractionOptions(track.id, null, { nbSamples: 1e9 });
      file.start();
    };
    file.onSamples = (_id, _user, batch) => {
      for (const s of batch) samples.push({ cts: s.cts, dts: s.dts, duration: s.duration, isSync: s.is_sync, data: s.data });
    };
    const ab = buffer;
    ab.fileStart = 0;
    try {
      file.appendBuffer(ab);
      file.flush();
    } catch (e) {
      return reject(new AnalysisError("demux_failed", `MP4를 읽지 못했습니다 (${String(e && e.message).slice(0, 80)}).`));
    }
    if (!track) return reject(new AnalysisError("unsupported_container", "MP4/MOV(H.264/HEVC) 영상만 자동 분석할 수 있습니다."));
    if (samples.length !== track.nb_samples) {
      return reject(new AnalysisError("demux_incomplete", "영상 샘플을 모두 읽지 못했습니다."));
    }
    const rotation = matrixRotation(track.matrix);
    const codedWidth = track.video ? track.video.width : track.track_width;
    const codedHeight = track.video ? track.video.height : track.track_height;
    const quarter = rotation === 90 || rotation === 270;
    const edits = trak.edts && trak.edts.elst ? trak.edts.elst.entries : [];
    const { order, pts } = presentationTimes(samples, track.timescale, edits, file.moov.mvhd.timescale);
    const last = samples[order[order.length - 1]];
    const durationS = pts.length ? pts[pts.length - 1] + (last ? last.duration / track.timescale : 0) : 0;
    resolve({
      codec: track.codec,
      codedWidth,
      codedHeight,
      width: quarter ? codedHeight : codedWidth,
      height: quarter ? codedWidth : codedHeight,
      rotation,
      description: codecDescription(trak),
      timescale: track.timescale,
      samples,
      order,
      pts,
      durationS,
    });
  });
}

// ---------- decode ----------

/** Throws an explicit unsupported failure when this browser cannot run analysis. */
export function checkBrowserSupport(g = globalThis) {
  const missing = ["VideoDecoder", "EncodedVideoChunk", "OffscreenCanvas"].filter((k) => typeof g[k] !== "function");
  if (missing.length) {
    throw new AnalysisError("unsupported_browser", `이 브라우저는 자동 분석을 지원하지 않습니다 (데스크톱 Chrome 권장; 없음: ${missing.join(", ")}).`);
  }
}

export async function decoderConfig(demux) {
  const config = { codec: demux.codec, codedWidth: demux.codedWidth, codedHeight: demux.codedHeight, optimizeForLatency: false };
  if (demux.description) config.description = demux.description;
  const support = await VideoDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
  if (!support.supported) throw new AnalysisError("unsupported_codec", `이 브라우저가 디코딩할 수 없는 코덱입니다 (${demux.codec}).`);
  return config;
}

/** A canvas painter that draws a decoded frame upright (container rotation applied). */
export function makePainter(demux, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const rot = demux.rotation;
  return (frame) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (rot) {
      ctx.translate(width / 2, height / 2);
      ctx.rotate((rot * Math.PI) / 180);
      const quarter = rot === 90 || rot === 270;
      const w = quarter ? height : width;
      const h = quarter ? width : height;
      ctx.drawImage(frame, -w / 2, -h / 2, w, h);
    } else {
      ctx.drawImage(frame, 0, 0, width, height);
    }
    return ctx.getImageData(0, 0, width, height).data;
  };
}

/**
 * Decode every sample once and yield `{ index, value }` in presentation order, where value
 * is `convert(frame, index)` (frames are closed right after conversion; at most a few are
 * alive). `stopAfter` ends decoding early once that presentation index has been yielded.
 */
export async function* decodeFrames(demux, config, convert, { signal, stopAfter = Infinity } = {}) {
  const byTimestamp = new Map();
  const chunks = demux.samples.map((s) => {
    const timestamp = Math.round((s.cts / demux.timescale) * 1e6);
    return { s, timestamp };
  });
  demux.order.forEach((sampleIndex, presIndex) => byTimestamp.set(chunks[sampleIndex].timestamp, presIndex));
  const queue = [];
  let failure = null;
  let wake = null;
  const notify = () => {
    const w = wake;
    wake = null;
    if (w) w();
  };
  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        const index = byTimestamp.get(frame.timestamp);
        if (index === undefined) throw new AnalysisError("decode_mismatch", "디코딩된 프레임 시각이 컨테이너와 다릅니다.");
        queue.push({ index, value: convert(frame, index) });
      } catch (e) {
        failure = failure || e;
      } finally {
        frame.close();
      }
      notify();
    },
    error: (e) => {
      failure = failure || new AnalysisError("decode_failed", `영상 디코딩 실패 (${String(e && e.message).slice(0, 80)}).`);
      notify();
    },
  });
  decoder.addEventListener?.("dequeue", notify);
  const wait = () => new Promise((r) => {
    wake = r;
    setTimeout(notify, 20);
  });
  let fed = 0;
  let flushed = false;
  let expected = 0;
  try {
    decoder.configure(config);
    while (true) {
      throwIfAborted(signal);
      if (failure) throw failure;
      if (queue.length) {
        queue.sort((a, b) => a.index - b.index);
        const item = queue.shift();
        if (item.index !== expected) throw new AnalysisError("decode_mismatch", "디코딩된 프레임 순서가 컨테이너와 다릅니다.");
        expected++;
        yield item;
        if (item.index >= stopAfter) return;
        continue;
      }
      if (fed < chunks.length) {
        if (decoder.decodeQueueSize >= 6) {
          await wait();
          continue;
        }
        const { s, timestamp } = chunks[fed++];
        decoder.decode(new EncodedVideoChunk({ type: s.isSync ? "key" : "delta", timestamp, duration: Math.round((s.duration / demux.timescale) * 1e6), data: s.data }));
        continue;
      }
      if (!flushed) {
        flushed = true;
        await decoder.flush();
        continue;
      }
      if (expected !== demux.order.length) throw new AnalysisError("decode_incomplete", `프레임 ${expected}/${demux.order.length}개만 디코딩되었습니다.`);
      return;
    }
  } finally {
    if (decoder.state !== "closed") decoder.close();
  }
}

// ---------- passes ----------

/**
 * Pass 1: TrackNet inputs (512x288 RGB, full frame stretched like R5 resize_input) and cut
 * histograms for every frame. Returns { frames, segments, excluded }.
 */
export async function trackingPass(demux, config, { signal, onFrame = () => {} } = {}) {
  const paintTrack = makePainter(demux, TRACK_SIZE.width, TRACK_SIZE.height);
  const paintThumb = makePainter(demux, THUMB_SIZE.width, THUMB_SIZE.height);
  const n = demux.order.length;
  const frames = new Array(n);
  const hists = new Array(n);
  for await (const { index, value } of decodeFrames(demux, config, (frame) => ({
    rgb: rgbaToRgb(paintTrack(frame)),
    hist: colorHistogram(paintThumb(frame)),
  }), { signal })) {
    frames[index] = value.rgb;
    hists[index] = value.hist;
    onFrame(index + 1, n);
  }
  const { segments, excluded } = segmentsFromCuts(n, detectCuts(hists));
  if (!segments.length) throw new AnalysisError("no_continuous_shot", `연속된 장면(${LIMITS.minSegmentFrames}프레임 이상)이 없습니다.`);
  return { frames, segments, excluded };
}

/** Pass 2 (streamed): aspect-preserving pose frames, longest side <= 1280, every frame in order. */
export async function* poseFrames(demux, config, { signal } = {}) {
  const size = fitWithin(demux.width, demux.height, POSE_MAX_SIDE);
  const paint = makePainter(demux, size.width, size.height);
  for await (const { index, value } of decodeFrames(demux, config, (frame) => rgbaToRgb(paint(frame)), { signal })) {
    yield { index, width: size.width, height: size.height, rgb: value };
  }
}

export const POSE_BUDGET_BYTES = 640 * 1024 * 1024;

/** Longest pose side (512..1280) so that n aspect-preserving RGB frames fit the budget. */
export function poseSideForBudget(width, height, n, budget = POSE_BUDGET_BYTES) {
  const aspect = Math.min(width, height) / Math.max(width, height);
  const side = Math.floor(Math.sqrt(budget / (3 * aspect * Math.max(1, n))));
  return Math.max(512, Math.min(POSE_MAX_SIDE, side));
}

/** Pass 2 (materialised): pose frames for every frame, sized by poseSideForBudget. */
export async function poseFrameArray(demux, config, { signal, onFrame = () => {}, budget = POSE_BUDGET_BYTES } = {}) {
  const n = demux.order.length;
  const size = fitWithin(demux.width, demux.height, poseSideForBudget(demux.width, demux.height, n, budget));
  const paint = makePainter(demux, size.width, size.height);
  const out = new Array(n);
  for await (const { index, value } of decodeFrames(demux, config, (frame) => rgbaToRgb(paint(frame)), { signal })) {
    out[index] = { width: size.width, height: size.height, rgb: value };
    onFrame(index + 1, n);
  }
  return out;
}

/** Pass 3: up to 25 evenly sampled frames of the longest segment, width <= 1920. */
export async function calibrationPass(demux, config, segments, { signal } = {}) {
  const [a, b] = longestSegment(segments);
  const wanted = new Set(evenIndices(a, b));
  const last = Math.max(...wanted);
  const size = fitWidth(demux.width, demux.height, CALIB_MAX_WIDTH);
  const paint = makePainter(demux, size.width, size.height);
  const out = [];
  for await (const { index, value } of decodeFrames(demux, config, (frame, i) => (wanted.has(i) ? rgbaToRgb(paint(frame)) : null), { signal, stopAfter: last })) {
    if (value) out.push({ frame_id: index, width: size.width, height: size.height, rgb: value });
  }
  return out;
}

export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
