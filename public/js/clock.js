// Estimates the offset between this phone's clock and the server's, the way
// NTP does: send our time, the server replies with its own, and half the
// round trip is assumed to be the one-way delay. The sample with the shortest
// round trip is the least distorted by network jitter, so that one wins.

const KEEP_SAMPLES = 20;

export class Clock {
  constructor(send) {
    this.send = send;
    this.samples = [];
    this.offset = 0;
    this.rtt = null;
    this.timer = null;
  }

  local() {
    return performance.timeOrigin + performance.now();
  }

  // Current server time in milliseconds.
  now() {
    return this.local() + this.offset;
  }

  get synced() {
    return this.samples.length >= 3;
  }

  ping() {
    this.send({ type: 'ping', t0: this.local() });
  }

  onPong({ t0, ts }) {
    const t1 = this.local();
    const rtt = t1 - t0;
    if (!(rtt >= 0) || !Number.isFinite(ts)) return;
    this.samples.push({ rtt, offset: ts + rtt / 2 - t1 });
    if (this.samples.length > KEEP_SAMPLES) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.offset;
    this.rtt = best.rtt;
  }

  // A quick burst to lock on, then a slow trickle to follow drift.
  start() {
    this.stop();
    let burst = 10;
    const tick = () => {
      this.ping();
      this.timer = setTimeout(tick, burst-- > 0 ? 150 : 3000);
    };
    tick();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  reset() {
    this.samples = [];
    this.rtt = null;
  }
}
