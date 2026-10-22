// Greedy IoU tracker: gives detections stable ids across frames, so a person keeps the same
// costume and a car the same carriage while they move, and smooths jitter.
const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

export class Tracker {
  constructor({ minIou = 0.2, maxMissed = 8, smooth = 0.45, sameLabel = (a, b) => a === b } = {}) {
    Object.assign(this, { minIou, maxMissed, smooth, sameLabel });
    this.tracks = []; this.nextId = 1;
  }

  update(dets) {
    const pairs = [];
    for (const t of this.tracks) for (let j = 0; j < dets.length; j++) {
      if (!this.sameLabel(t.label, dets[j].label)) continue;
      const s = iou(t.box, dets[j].box); if (s >= this.minIou) pairs.push([s, t, j]);
    }
    pairs.sort((a, b) => b[0] - a[0]);
    const usedT = new Set(), usedD = new Set();
    for (const [, t, j] of pairs) {
      if (usedT.has(t) || usedD.has(j)) continue;
      usedT.add(t); usedD.add(j);
      const d = dets[j], k = this.smooth, cx = t.box.x + t.box.w / 2;
      for (const key of ['x', 'y', 'w', 'h']) t.box[key] += (d.box[key] - t.box[key]) * (1 - k);
      t.vx = t.vx * 0.7 + ((t.box.x + t.box.w / 2) - cx) * 0.3;
      t.score = d.score; t.data = d.data; t.missed = 0; t.age++;
      if (d.label !== t.label) t.label = d.label;
    }
    for (const t of this.tracks) if (!usedT.has(t)) t.missed++;
    this.tracks = this.tracks.filter((t) => t.missed <= this.maxMissed);
    dets.forEach((d, j) => {
      if (usedD.has(j)) return;
      this.tracks.push({ id: this.nextId++, label: d.label, box: { ...d.box }, score: d.score, data: d.data, vx: 0, missed: 0, age: 1 });
    });
    return this.tracks;
  }

  clear() { this.tracks = []; }
}
