// On-device scene understanding with MediaPipe: body pose + per-person segmentation masks
// (who is where, and which pixels are them) and COCO object detection (vehicles, benches...).
import { MEDIAPIPE_WASM, MODELS } from './config.js';

export const MAX_PEOPLE = 4;
const overlap = (a, b) => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y / Math.min(a.w * a.h, b.w * b.h);
};
const RELEVANT = new Set(['person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck', 'bench', 'chair',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'horse']);

export class Vision {
  constructor() {
    this.ready = false; this.mode = null; this.frame = 0;
    this.work = document.createElement('canvas');
    this.wctx = this.work.getContext('2d', { willReadFrequently: false });
    this.mask = { data: null, w: 0, h: 0, version: 0 };
    this.objects = []; this.people = [];
  }

  async init(onProgress = () => {}) {
    onProgress('טוען את מנוע הראייה…');
    // Loaded on demand, so the rest of the app works even if this CDN is unreachable.
    const { FilesetResolver, ObjectDetector, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    const make = async (Task, opts) => {
      try { return await Task.createFromOptions(fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'GPU' } }); }
      catch (e) { return Task.createFromOptions(fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'CPU' } }); }
    };
    onProgress('טוען מודל זיהוי תנוחת גוף…');
    this.pose = await make(PoseLandmarker, {
      baseOptions: { modelAssetPath: MODELS.pose }, runningMode: 'VIDEO', numPoses: MAX_PEOPLE,
      minPoseDetectionConfidence: 0.35, minPosePresenceConfidence: 0.35, minTrackingConfidence: 0.35, outputSegmentationMasks: true,
    });
    // A second pose model looks at one person at a time, for people the full-frame pass missed.
    this.posePerson = await make(PoseLandmarker, {
      baseOptions: { modelAssetPath: MODELS.pose }, runningMode: 'IMAGE', numPoses: 1,
      minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, outputSegmentationMasks: true,
    });
    this.crop = document.createElement('canvas'); this.cctx = this.crop.getContext('2d');
    this.extra = [];
    onProgress('טוען מודל זיהוי אובייקטים…');
    this.detector = await make(ObjectDetector, {
      baseOptions: { modelAssetPath: MODELS.detector }, runningMode: 'VIDEO', scoreThreshold: 0.3, maxResults: 16,
    });
    this.mode = 'VIDEO'; this.ready = true;
  }

  async setMode(mode) {
    if (!this.ready || this.mode === mode) return;
    await Promise.all([this.pose.setOptions({ runningMode: mode }), this.detector.setOptions({ runningMode: mode })]);
    this.mode = mode;
  }

  /** Analyse one frame. `source` is a video, image or canvas; returns normalized (0..1) results. */
  analyze(source, srcW, srcH, ts, { detectObjects = true, workWidth = 448 } = {}) {
    if (!this.ready || !srcW || !srcH) return null;
    const w = Math.round(Math.min(workWidth, srcW)), h = Math.round(w * srcH / srcW);
    if (this.work.width !== w || this.work.height !== h) { this.work.width = w; this.work.height = h; }
    this.wctx.drawImage(source, 0, 0, w, h);
    const still = this.mode === 'IMAGE';
    const pose = still ? this.pose.detect(this.work) : this.pose.detectForVideo(this.work, ts);
    this.people = this.readPeople(pose, w, h);
    if (detectObjects) {
      const det = still ? this.detector.detect(this.work) : this.detector.detectForVideo(this.work, ts);
      this.objects = det.detections.map((d) => {
        const c = d.categories[0], b = d.boundingBox;
        return { label: c.categoryName, score: c.score, box: { x: b.originX / w, y: b.originY / h, w: b.width / w, h: b.height / h } };
      }).filter((d) => RELEVANT.has(d.label));
      this.extra = this.posePeopleMissed(w, h);
    }
    this.mergeExtra();
    this.frame++;
    return { people: this.people, objects: this.objects, mask: this.mask };
  }

  /** Run single-person pose on detector boxes that the multi-person pass did not cover. */
  posePeopleMissed(w, h) {
    const out = [];
    const covered = (b) => this.people.some((p) => overlap(p.box, b) > 0.35);
    const boxes = this.objects.filter((o) => o.label === 'person' && o.score > 0.4 && !covered(o.box)).sort((a, b) => b.box.h - a.box.h);
    for (const o of boxes) {
      if (this.people.length + out.length >= MAX_PEOPLE) break;
      const b = o.box, px = b.w * 0.2, py = b.h * 0.08;
      const x0 = Math.max(0, b.x - px), y0 = Math.max(0, b.y - py), x1 = Math.min(1, b.x + b.w + px), y1 = Math.min(1, b.y + b.h + py);
      const sw = (x1 - x0) * w, sh = (y1 - y0) * h; if (sw < 12 || sh < 24) continue;
      const k = 256 / Math.max(sw, sh); this.crop.width = Math.round(sw * k); this.crop.height = Math.round(sh * k);
      this.cctx.drawImage(this.work, x0 * w, y0 * h, sw, sh, 0, 0, this.crop.width, this.crop.height);
      const r = this.posePerson.detect(this.crop);
      if (r.landmarks.length) {
        const lm = r.landmarks[0].map((p) => ({ ...p, x: x0 + p.x * (x1 - x0), y: y0 + p.y * (y1 - y0) }));
        const m = r.segmentationMasks?.[0];
        out.push({ landmarks: lm, box: { ...b }, mask: m ? { data: m.getAsFloat32Array().slice(), w: m.width, h: m.height, x0, y0, x1, y1 } : null });
      }
      for (const m of r.segmentationMasks || []) m.close();
    }
    return out;
  }

  /** Add the single-person results to this frame's people and mask channels. */
  mergeExtra() {
    if (!this.extra.length || !this.mask.data) return;
    const M = this.mask, out = M.data;
    for (const e of this.extra) {
      if (this.people.length >= MAX_PEOPLE) break;
      if (this.people.some((p) => overlap(p.box, e.box) > 0.35)) continue;
      const ch = this.people.length;
      this.people.push({ label: 'person', score: 1, channel: ch, landmarks: e.landmarks, box: e.box });
      if (!e.mask) continue;
      const { data, w, h, x0, y0, x1, y1 } = e.mask;
      const X0 = Math.floor(x0 * M.w), X1 = Math.ceil(x1 * M.w), Y0 = Math.floor(y0 * M.h), Y1 = Math.ceil(y1 * M.h);
      for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
        const u = Math.min(w - 1, Math.floor((x / M.w - x0) / (x1 - x0) * w)), v = Math.min(h - 1, Math.floor((y / M.h - y0) / (y1 - y0) * h));
        const val = data[v * w + u] * 255; const i = (y * M.w + x) * 4 + ch; if (val > out[i]) out[i] = val;
      }
    }
    M.version++;
  }

  readPeople(result, w, h) {
    const masks = result.segmentationMasks || [];
    const n = Math.min(result.landmarks.length, MAX_PEOPLE);
    // Pack up to four per-person confidence masks into one RGBA texture (one person per channel).
    if (masks.length) {
      const mw = masks[0].width, mh = masks[0].height;
      if (!this.mask.data || this.mask.w !== mw || this.mask.h !== mh) this.mask = { data: new Uint8Array(mw * mh * 4), w: mw, h: mh, version: 0 };
      const out = this.mask.data; out.fill(0);
      for (let i = 0; i < n; i++) {
        const m = masks[i].getAsFloat32Array();
        for (let p = 0; p < m.length; p++) out[p * 4 + i] = m[p] * 255;
      }
      this.mask.version++;
    } else if (this.mask.data) { this.mask.data.fill(0); this.mask.version++; }
    for (const m of masks) m.close();
    const people = [];
    for (let i = 0; i < n; i++) {
      const lm = result.landmarks[i];
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const p of lm) { if ((p.visibility ?? 1) < 0.3) continue; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      if (x1 <= x0 || y1 <= y0) continue;
      const pad = (x1 - x0) * 0.15;
      people.push({ label: 'person', score: 1, channel: i, landmarks: lm, box: { x: x0 - pad, y: y0 - pad * 1.5, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 } });
    }
    return people;
  }
}
