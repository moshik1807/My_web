// Plays the room's current track through Web Audio so that every phone emits
// the same sample at the same wall-clock moment.
//
// The server sends `startAt`: the server time at which position 0 of the
// track should be heard. Using the synced clock we turn that into an
// AudioContext time, subtract this phone's output latency (plus the user's
// manual calibration), and start the buffer there. A periodic check restarts
// the buffer if the audio clock has drifted away from the wall clock.

const DRIFT_TOLERANCE_S = 0.02;
const MIN_LEAD_S = 0.05;

export class SyncPlayer {
  constructor(clock) {
    this.clock = clock;
    this.ctx = null;
    this.gain = null;
    this.buffers = new Map();
    this.loading = new Map();
    this.source = null;
    this.playback = null;
    this.volume = 1;
    this.calibrationMs = 0;
    this.onChange = () => {};
    this.driftTimer = null;
  }

  get unlocked() {
    return this.ctx?.state === 'running';
  }

  // Must run inside a tap: mobile browsers only allow audio after a gesture.
  async unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'playback' });
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
      this.ctx.addEventListener('statechange', () => this.onChange());
    }
    await this.ctx.resume();
    // iOS needs a sound started inside the gesture to fully wake up.
    const blip = this.ctx.createBufferSource();
    blip.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    blip.connect(this.ctx.destination);
    blip.start();
    clearInterval(this.driftTimer);
    this.driftTimer = setInterval(() => this.sync(), 1000);
    this.sync();
    this.onChange();
  }

  // Seconds between scheduling a sample and it leaving the speaker.
  outputLatency() {
    if (!this.ctx) return 0;
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0) + this.calibrationMs / 1000;
  }

  isReady(trackId) {
    return this.buffers.has(trackId);
  }

  load(trackId, url) {
    if (this.buffers.has(trackId)) return Promise.resolve(this.buffers.get(trackId));
    if (this.loading.has(trackId)) return this.loading.get(trackId);
    const promise = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      // Decoding needs a context; an offline one works before the user taps.
      const ctx = this.ctx ?? new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, 1, 44100);
      const buffer = await new Promise((resolve, reject) => {
        const p = ctx.decodeAudioData(data, resolve, reject);
        p?.catch?.(reject);
      });
      this.buffers.set(trackId, buffer);
      return buffer;
    })();
    this.loading.set(trackId, promise);
    promise
      .catch(() => {})
      .finally(() => {
        this.loading.delete(trackId);
        this.sync();
        this.onChange();
      });
    return promise;
  }

  forget(keepIds) {
    for (const id of this.buffers.keys()) if (!keepIds.has(id)) this.buffers.delete(id);
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.gain) this.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
  }

  setCalibration(ms) {
    this.calibrationMs = ms;
    this.sync(true);
  }

  apply(playback) {
    const changed = !this.playback || this.playback.rev !== playback?.rev;
    this.playback = playback;
    if (changed) this.sync(true);
  }

  // AudioContext time at which position 0 of the track must be started.
  targetStart() {
    // getOutputTimestamp pairs the sample leaving the speaker right now with
    // a precise performance.now(), so it already accounts for output latency
    // and avoids the coarse steps of ctx.currentTime.
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts?.performanceTime > 0) {
      const perfAt = this.playback.startAt - this.clock.offset - performance.timeOrigin;
      return ts.contextTime + (perfAt - ts.performanceTime) / 1000 - this.calibrationMs / 1000;
    }
    const ctxNow = this.ctx.currentTime;
    return ctxNow + (this.playback.startAt - this.clock.now()) / 1000 - this.outputLatency();
  }

  // Current position in seconds as heard from this phone, for the UI.
  position() {
    const pb = this.playback;
    if (!pb) return 0;
    if (pb.status === 'playing') return Math.max(0, (this.clock.now() - pb.startAt) / 1000);
    return pb.position || 0;
  }

  stopSource() {
    if (!this.source) return;
    try {
      this.source.node.stop();
    } catch {}
    this.source.node.disconnect();
    this.source = null;
  }

  sync(force = false) {
    const pb = this.playback;
    if (!this.ctx || this.ctx.state !== 'running' || !pb || pb.status !== 'playing') {
      this.stopSource();
      return;
    }
    const buffer = this.buffers.get(pb.trackId);
    if (!buffer) {
      this.stopSource();
      return;
    }
    const c0 = this.targetStart();
    const src = this.source;
    if (!force && src && src.rev === pb.rev) {
      // Restarting is audible, so ignore a single odd clock reading and only
      // correct drift that shows up twice in a row.
      if (Math.abs(src.c0 - c0) < DRIFT_TOLERANCE_S) {
        src.strikes = 0;
        return;
      }
      if (++src.strikes < 2) return;
    }

    const when = Math.max(c0, this.ctx.currentTime + MIN_LEAD_S);
    const offset = when - c0;
    this.stopSource();
    if (offset >= buffer.duration) return;
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.gain);
    node.start(when, offset);
    this.source = { node, rev: pb.rev, c0, strikes: 0 };
  }
}
