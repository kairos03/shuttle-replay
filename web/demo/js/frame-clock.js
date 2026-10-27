// SPDX-License-Identifier: AGPL-3.0-only
// One redraw loop per video: requestVideoFrameCallback when available
// (reports the presented frame's mediaTime), requestAnimationFrame otherwise.

export class FrameClock {
  constructor(video, onTick, win = globalThis) {
    this.video = video;
    this.onTick = onTick;
    this.win = win;
    this.handle = null;
    this.kind = null;
    this.running = false;
  }

  get usesVideoFrameCallback() {
    return typeof this.video.requestVideoFrameCallback === "function";
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._schedule();
  }

  _schedule() {
    if (!this.running) return;
    if (this.usesVideoFrameCallback) {
      this.kind = "vfc";
      this.handle = this.video.requestVideoFrameCallback((_now, meta) => {
        this.handle = null;
        if (!this.running) return;
        this.onTick(meta && Number.isFinite(meta.mediaTime) ? meta.mediaTime : this.video.currentTime);
        this._schedule();
      });
    } else {
      this.kind = "raf";
      this.handle = this.win.requestAnimationFrame(() => {
        this.handle = null;
        if (!this.running) return;
        this.onTick(this.video.currentTime);
        this._schedule();
      });
    }
  }

  stop() {
    this.running = false;
    if (this.handle !== null) {
      if (this.kind === "vfc") this.video.cancelVideoFrameCallback?.(this.handle);
      else this.win.cancelAnimationFrame(this.handle);
    }
    this.handle = null;
  }
}
