// Live scene understanding: every pixel of the camera frame is classified (SegFormer, ADE20K's
// 150 classes) and grouped into what the era changes: sky, buildings, road, pavement, plants,
// vehicles, people and modern clutter (poles, signs, lights). Runs on the phone with ONNX
// Runtime (WebGPU when available, otherwise WebAssembly), in the background of the video.
import { ORT_URL, SEG_MODEL } from './config.js';

const GROUPS = {
  sky: ['sky'],
  building: ['wall', 'building', 'house', 'skyscraper', 'tower', 'column', 'door', 'windowpane', 'fence', 'railing', 'bannister', 'hovel', 'booth', 'bridge', 'stairway', 'ceiling'],
  road: ['road', 'floor', 'path', 'dirt track', 'runway', 'earth', 'land', 'sand', 'field', 'rug'],
  walk: ['sidewalk', 'stairs', 'step', 'grandstand'],
  plant: ['tree', 'grass', 'plant', 'palm', 'flower', 'hill', 'mountain', 'rock'],
  vehicle: ['car', 'bus', 'truck', 'van', 'minibike', 'bicycle', 'motorbike', 'boat', 'ship', 'airplane'],
  person: ['person'],
  clutter: ['pole', 'streetlight', 'signboard', 'traffic light', 'trade name', 'poster', 'screen', 'crt screen', 'monitor', 'television receiver', 'awning', 'ashcan', 'bulletin board', 'box', 'canopy', 'light', 'sconce', 'flag', 'bag', 'barrel', 'tent', 'umbrella', 'kiosk', 'bench', 'chair', 'seat', 'fountain'],
};
// Output channels, packed into two RGBA textures.
export const CH = { sky: 0, building: 1, road: 2, walk: 3, plant: 4, person: 5, removed: 6, other: 7 };

export class SceneParser {
  constructor() { this.ready = false; this.busy = false; this.ms = 0; this.fps = 0; this.version = 0; this.horizon = 0.45; }

  async init(onProgress = () => {}) {
    onProgress('טוען את מנוע הבנת הסצנה…');
    const ort = await import(ORT_URL);
    ort.env.wasm.wasmPaths = ORT_URL.slice(0, ORT_URL.lastIndexOf('/') + 1);
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    this.ort = ort;
    onProgress('מוריד את מודל הסצנה (פעם אחת, כ-15MB)…');
    const cfg = await (await fetch(SEG_MODEL.config)).json();
    const names = Object.entries(cfg.id2label).sort((a, b) => a[0] - b[0]).map(([, n]) => n.toLowerCase());
    this.nClasses = names.length;
    // class index -> group index (or -1 = keep the camera as is)
    const order = ['sky', 'building', 'road', 'walk', 'plant', 'vehicle', 'person', 'clutter'];
    this.groupOf = new Int8Array(this.nClasses).fill(-1);
    names.forEach((n, i) => { order.forEach((g, gi) => { if (GROUPS[g].some((x) => n === x || n.split(/[;,]\s*/).includes(x))) this.groupOf[i] = gi; }); });
    let gpu = false;
    try { gpu = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { gpu = false; }
    let lastErr;
    for (const [file, providers] of gpu ? [[SEG_MODEL.fp32, ['webgpu', 'wasm']], [SEG_MODEL.q8, ['wasm']]] : [[SEG_MODEL.q8, ['wasm']], [SEG_MODEL.fp32, ['wasm']]]) {
      try {
        this.session = await ort.InferenceSession.create(file, { executionProviders: providers, graphOptimizationLevel: 'all' });
        this.provider = providers[0]; break;
      } catch (e) { lastErr = e; }
    }
    if (!this.session) throw lastErr;
    this.inName = this.session.inputNames[0]; this.outName = this.session.outputNames[0];
    this.side = this.provider === 'webgpu' ? 384 : 256;
    this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.ready = true;
  }

  /** Start one inference on the current frame unless one is already running. */
  async update(video) {
    if (!this.ready || this.busy || !video.videoWidth) return;
    this.busy = true; const t0 = performance.now();
    try {
      const vw = video.videoWidth, vh = video.videoHeight, k = this.side / Math.max(vw, vh);
      const w = Math.max(32, Math.round(vw * k / 32) * 32), h = Math.max(32, Math.round(vh * k / 32) * 32);
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.ctx.drawImage(video, 0, 0, w, h);
      const px = this.ctx.getImageData(0, 0, w, h).data, n = w * h, input = new Float32Array(3 * n);
      const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) input[c * n + i] = (px[i * 4 + c] / 255 - mean[c]) / std[c];
      const out = await this.session.run({ [this.inName]: new this.ort.Tensor('float32', input, [1, 3, h, w]) });
      const logits = out[this.outName];
      this.postprocess(logits.data, logits.dims[2], logits.dims[3]);
      if (logits.dispose) logits.dispose();
      const ms = performance.now() - t0; this.ms = this.ms ? this.ms * 0.8 + ms * 0.2 : ms; this.fps = 1000 / this.ms;
    } finally { this.busy = false; }
  }

  postprocess(L, h, w) {
    const n = w * h, C = this.nClasses, G = 8;
    const prob = new Float32Array(n * G);
    for (let i = 0; i < n; i++) {
      let mx = -1e9; for (let c = 0; c < C; c++) { const v = L[c * n + i]; if (v > mx) mx = v; }
      let sum = 0; const g = new Float32Array(G + 1);
      for (let c = 0; c < C; c++) { const e = Math.exp(L[c * n + i] - mx); sum += e; const gi = this.groupOf[c]; g[gi < 0 ? G : gi] += e; }
      for (let k = 0; k < G; k++) prob[i * G + k] = g[k] / sum;
    }
    // Vehicles and clutter are removed: their area takes the material that surrounds them
    // (sky, building, road or pavement), found by blurring those four maps.
    const R = Math.max(3, Math.round(w / 16)), blur = new Float32Array(n * 4), tmp = new Float32Array(n * 4);
    for (let y = 0; y < h; y++) for (let k = 0; k < 4; k++) {
      let acc = 0; for (let x = -R; x <= R; x++) acc += prob[(y * w + Math.min(w - 1, Math.max(0, x))) * G + k];
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 4 + k] = acc / (2 * R + 1);
        acc += prob[(y * w + Math.min(w - 1, x + R + 1)) * G + k] - prob[(y * w + Math.max(0, x - R)) * G + k];
      }
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) {
      let acc = 0; for (let y = -R; y <= R; y++) acc += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 4 + k];
      for (let y = 0; y < h; y++) {
        blur[(y * w + x) * 4 + k] = acc / (2 * R + 1);
        acc += tmp[(Math.min(h - 1, y + R + 1) * w + x) * 4 + k] - tmp[(Math.max(0, y - R) * w + x) * 4 + k];
      }
    }
    const a = this.a && this.a.length === n * 4 ? this.a : new Uint8Array(n * 4), b = this.b && this.b.length === n * 4 ? this.b : new Uint8Array(n * 4);
    const fresh = this.w !== w || this.h !== h, keep = fresh ? 0 : 0.3;
    let roadTop = h;
    for (let i = 0; i < n; i++) {
      const p = prob.subarray(i * G, i * G + G), removed = p[5] + p[7];
      const bl = blur.subarray(i * 4, i * 4 + 4); let best = 0; for (let k = 1; k < 4; k++) if (bl[k] > bl[best]) best = k;
      const out = [p[0], p[1], p[2], p[3]]; out[best] += removed;
      const other = Math.max(0, 1 - p[0] - p[1] - p[2] - p[3] - p[4] - p[6] - removed);
      const vals = [out[0], out[1], out[2], out[3], p[4], p[6], removed, other];
      for (let k = 0; k < 4; k++) { a[i * 4 + k] = a[i * 4 + k] * keep + vals[k] * 255 * (1 - keep); b[i * 4 + k] = b[i * 4 + k] * keep + vals[k + 4] * 255 * (1 - keep); }
      if (out[2] + out[3] > 0.5) { const y = Math.floor(i / w); if (y < roadTop) { let cnt = 0; for (let x = 0; x < w; x += 4) { const j = y * w + x; if (prob[j * G + 2] + prob[j * G + 3] > 0.5) cnt++; } if (cnt > w / 40) roadTop = y; } }
    }
    const hz = Math.min(0.9, Math.max(0.15, roadTop / h - 0.02));
    this.horizon = fresh ? hz : this.horizon * 0.85 + hz * 0.15;
    this.a = a; this.b = b; this.w = w; this.h = h; this.version++;
  }
}
