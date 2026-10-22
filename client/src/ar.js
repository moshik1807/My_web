// The live "window to the past": camera (or photo) in, period scene out.
// Each frame: detect people and objects → track them → swap vehicles and seats for period
// models, dress people in period clothing, re-dye what remains of their clothes, and grade the
// whole picture like a photograph of that era. Outside the X-ray lens the camera stays as is.
import * as THREE from 'three';
import { Vision, MAX_PEOPLE } from './vision.js';
import { Tracker } from './tracker.js';
import { buildProp, PROP_NAMES } from './models.js';
import { drawCostumes, bodyGeometry } from './costume.js';
import { pickVariant } from './periods.js';

const GRADES = { none: 0, albumen: 1, ortho: 2, kodachrome: 3, future: 4 };
const VEHICLES = new Set(['car', 'motorcycle', 'bicycle', 'bus', 'truck']);
const MAX_ERASE = 8;
// Typical real heights (m) of what the detector finds; sets the scale for the period model.
const REAL_H = { car: 1.5, bus: 3.0, truck: 3.2, motorcycle: 1.15, bicycle: 1.05, bench: 0.85, chair: 0.9, 'traffic light': 3.4, 'fire hydrant': 0.75, 'stop sign': 2.4, 'parking meter': 1.4, horse: 1.7 };

const hexToVec = (hex) => { const n = parseInt(hex.slice(1), 16); return new THREE.Vector3((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

const compositeShader = {
  uniforms: {
    tSource: { value: null }, tBlur: { value: null }, tProps: { value: null }, tCostume: { value: null }, tMask: { value: null },
    srcMap: { value: new THREE.Vector4(1, 1, 0, 0) }, res: { value: new THREE.Vector2(1, 1) }, time: { value: 0 },
    grade: { value: 0 }, gradeAmt: { value: 1 }, transform: { value: 1 },
    lensOn: { value: 0 }, lensC: { value: new THREE.Vector2() }, lensR: { value: 200 },
    erase: { value: Array.from({ length: MAX_ERASE }, () => new THREE.Vector4()) }, eraseN: { value: 0 },
    pOn: { value: [0, 0, 0, 0] }, pColor: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) },
    pShoulder: { value: [0, 0, 0, 0] }, pHead: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) },
    pWrists: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }, pSw: { value: [1, 1, 1, 1] },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tSource, tBlur, tProps, tCostume, tMask;
    uniform vec4 srcMap; uniform vec2 res; uniform float time, gradeAmt, transform, lensOn, lensR;
    uniform int grade, eraseN; uniform vec2 lensC;
    uniform vec4 erase[${MAX_ERASE}];
    uniform float pOn[4]; uniform vec3 pColor[4]; uniform float pShoulder[4]; uniform vec3 pHead[4]; uniform vec4 pWrists[4]; uniform float pSw[4];
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    vec2 toSrc(vec2 uv){ return uv * srcMap.xy + srcMap.zw; }
    bool inside01(vec2 s){ return s.x >= 0.0 && s.x <= 1.0 && s.y >= 0.0 && s.y <= 1.0; }
    vec3 src(vec2 uv){ vec2 s = toSrc(uv); return inside01(s) ? texture2D(tSource, s).rgb : vec3(0.04); }
    vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

    vec3 applyGrade(vec3 c, vec2 uv, int g){
      float n = hash(uv * res + fract(time * 13.0) * 100.0) - 0.5;
      vec2 q = uv - 0.5; float vig = 1.0 - dot(q, q) * 1.6;
      if (g == 1) { // 1880s albumen print
        float l = lum(c); l = mix(0.5, l, 0.8) + 0.03;
        vec3 s = vec3(l) * vec3(1.13, 0.96, 0.72) + vec3(0.05, 0.025, -0.01);
        s = mix(s, vec3(0.93, 0.86, 0.72), smoothstep(0.75, 1.1, l) * 0.5);
        s *= mix(0.55, 1.0, clamp(vig, 0.0, 1.0)); s += n * 0.07;
        vec2 cell = floor(uv * 60.0); vec2 f = fract(uv * 60.0) - 0.5; float spot = step(0.993, hash(cell + floor(time * 3.0)));
        s = mix(s, vec3(0.25, 0.18, 0.12), spot * smoothstep(0.18, 0.0, length(f)) * 0.6);
        return s;
      }
      if (g == 2) { // 1920s orthochromatic black and white
        float l = dot(c, vec3(0.12, 0.43, 0.45)); l = smoothstep(0.03, 0.97, l);
        l *= 0.97 + 0.03 * sin(time * 23.0);
        l *= mix(0.6, 1.0, clamp(vig, 0.0, 1.0)); l += n * 0.09;
        float sx = hash(vec2(floor(time * 9.0), 7.0)); float scratch = smoothstep(0.0015, 0.0, abs(uv.x - sx)) * step(0.6, hash(vec2(floor(time * 9.0), 3.0)));
        l = mix(l, 0.85, scratch * 0.6);
        return vec3(l) * vec3(1.0, 0.99, 0.96);
      }
      if (g == 3) { // faded 1970s Kodachrome
        float l = lum(c);
        vec3 s = c * vec3(1.08, 1.0, 0.84);
        s += (1.0 - l) * vec3(-0.01, 0.025, 0.045);
        s = mix(vec3(l), s, 1.12);
        s = s * 0.88 + 0.07;
        s *= mix(0.8, 1.0, clamp(vig, 0.0, 1.0)); s += n * 0.035;
        return s;
      }
      if (g == 4) { // 2050: cool, clean
        vec3 s = c * vec3(0.93, 1.02, 1.07); s = mix(vec3(lum(s)), s, 1.08);
        s += texture2D(tBlur, toSrc(uv)).rgb * 0.08;
        return s + n * 0.012;
      }
      return c;
    }

    void main(){
      vec2 uv = vUv; vec2 px = vec2(uv.x * res.x, (1.0 - uv.y) * res.y);
      vec2 sUv = toSrc(uv);
      vec3 cam = src(uv);
      vec3 col = cam;
      float mainA = transform;
      // Remove replaced objects: fill the box by blending the colours just outside its four
      // edges (a soft patch, like a wall or road behind the object), plus a little texture.
      float er = 0.0; vec3 fill = vec3(0.0);
      for (int i = 0; i < ${MAX_ERASE}; i++) {
        if (i >= eraseN) break;
        vec4 b = erase[i];
        vec2 d = min(uv - b.xy, b.xy + b.zw - uv);
        float a = smoothstep(0.0, 0.015, min(d.x, d.y));
        if (a > 0.0) {
          vec2 t = clamp((uv - b.xy) / b.zw, 0.0, 1.0); float e = 0.01;
          vec3 cl = texture2D(tBlur, toSrc(vec2(b.x - e, uv.y))).rgb, cr = texture2D(tBlur, toSrc(vec2(b.x + b.z + e, uv.y))).rgb;
          vec3 cb = texture2D(tBlur, toSrc(vec2(uv.x, b.y - e))).rgb, ct = texture2D(tBlur, toSrc(vec2(uv.x, b.y + b.w + e))).rgb;
          vec3 hz = mix(cl, cr, t.x), vt = mix(cb, ct, t.y);
          float wh = min(t.x, 1.0 - t.x), wv = min(t.y, 1.0 - t.y);
          vec3 f = mix(hz, vt, wh / max(wh + wv, 1e-3));
          f += (hash(floor(uv * res / 2.0)) - 0.5) * 0.04;
          if (a > er) { er = a; fill = f; }
        }
      }
      col = mix(col, fill, er * mainA);
      // Period models.
      vec4 pr = texture2D(tProps, uv);
      col = mix(col, toSRGB(pr.rgb / max(pr.a, 1e-4)), pr.a * mainA);
      // People stay in front of the models; their remaining clothes are re-dyed.
      vec4 m = texture2D(tMask, vec2(sUv.x, 1.0 - sUv.y));
      float conf[4]; conf[0] = m.r; conf[1] = m.g; conf[2] = m.b; conf[3] = m.a;
      float best = 0.0; int bi = -1;
      for (int i = 0; i < 4; i++) { if (pOn[i] > 0.5 && conf[i] > best) { best = conf[i]; bi = i; } }
      if (bi >= 0 && inside01(sUv)) {
        float pa = smoothstep(0.35, 0.75, best);
        vec3 person = cam;
        float clothes = 0.0;
        for (int i = 0; i < 4; i++) {
          if (i != bi) continue;
          float sw = pSw[i];
          float below = smoothstep(pShoulder[i] - sw * 0.1, pShoulder[i] + sw * 0.05, px.y);
          float head = smoothstep(pHead[i].z * 1.1, pHead[i].z * 1.35, distance(px, pHead[i].xy));
          float hands = smoothstep(sw * 0.16, sw * 0.24, distance(px, pWrists[i].xy)) * smoothstep(sw * 0.16, sw * 0.24, distance(px, pWrists[i].zw));
          float skin = smoothstep(0.04, 0.1, cam.r - cam.b) * step(cam.b, cam.g) * step(cam.g, cam.r) * smoothstep(0.25, 0.45, lum(cam)) * smoothstep(0.85, 0.65, lum(cam));
          clothes = below * head * hands * (1.0 - skin * 0.85);
          float l = lum(cam);
          vec3 dyed = pColor[i] * (0.25 + l * 1.45);
          person = mix(cam, dyed, clothes * 0.88);
        }
        col = mix(col, person, pa * mainA);
      }
      vec4 cos = texture2D(tCostume, uv);
      col = mix(col, cos.rgb, cos.a * mainA);
      vec3 graded = mix(col, applyGrade(col, uv, grade), gradeAmt * mainA);
      // X-ray lens: the past inside, the present outside.
      float d = distance(px, lensC);
      float insideLens = lensOn > 0.5 ? 1.0 - smoothstep(lensR - 1.5, lensR + 1.5, d) : 1.0;
      vec3 outside = cam * mix(1.0, 0.82, lensOn);
      vec3 outc = mix(outside, graded, insideLens);
      float ring = lensOn * (smoothstep(lensR - 1.0, lensR + 1.0, d) - smoothstep(lensR + 5.0, lensR + 7.5, d));
      vec2 dv = px - lensC;
      outc = mix(outc, vec3(0.85, 0.64, 0.36) * (0.8 + 0.2 * sin(atan(dv.y, dv.x) * 2.0 + time * 0.6)), ring);
      gl_FragColor = vec4(outc, 1.0);
    }`,
};

const copyShader = {
  uniforms: { tSource: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D tSource; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSource, vUv).rgb, 1.0); }',
};

function shadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(0,0,0,0.6)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}

export class ARView {
  constructor(renderer) {
    this.renderer = renderer;
    this.vision = new Vision();
    this.people = new Tracker({ minIou: 0.15, maxMissed: 6, smooth: 0.35 });
    const vehicleLike = (a, b) => a === b || (VEHICLES.has(a) && VEHICLES.has(b));
    this.objects = new Tracker({ minIou: 0.2, maxMissed: 10, smooth: 0.5, sameLabel: vehicleLike });
    this.source = null; this.profile = null;
    this.layers = { people: true, transport: true, furniture: true, grade: true };
    this.lens = { on: false, x: 0, y: 0, r: 150 };
    this.W = 1; this.H = 1; this.dpr = 1;
    this.frameNo = 0; this.light = 1; this.visionMs = 0; this.summary = [];

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ ...compositeShader, depthTest: false, depthWrite: false }));
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.copy = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ ...copyShader, depthTest: false }));
    this.copyScene = new THREE.Scene(); this.copyScene.add(this.copy);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.blurRT = new THREE.WebGLRenderTarget(96, 54);
    this.lightRT = new THREE.WebGLRenderTarget(8, 8);
    this.lightBuf = new Uint8Array(8 * 8 * 4);
    this.propsRT = new THREE.WebGLRenderTarget(1, 1, { samples: 4 });

    this.propScene = new THREE.Scene();
    this.propCam = new THREE.OrthographicCamera(0, 1, 1, 0, -5000, 5000);
    this.hemi = new THREE.HemisphereLight('#fff6e8', '#5a5048', 1.4); this.propScene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.2); this.sun.position.set(-0.6, 1, 0.8); this.propScene.add(this.sun);
    this.props = new Map(); this.shadowTex = shadowTexture();

    this.costumeCanvas = document.createElement('canvas');
    this.cctx = this.costumeCanvas.getContext('2d');
    this.costumeTex = new THREE.CanvasTexture(this.costumeCanvas);
    this.costumeTex.colorSpace = THREE.NoColorSpace;
    this.maskTex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    this.maskTex.magFilter = this.maskTex.minFilter = THREE.LinearFilter; this.maskTex.needsUpdate = true;
    const u = this.quad.material.uniforms;
    u.tBlur.value = this.blurRT.texture; u.tProps.value = this.propsRT.texture; u.tCostume.value = this.costumeTex; u.tMask.value = this.maskTex;
  }

  async init(onProgress) { await this.vision.init(onProgress); }

  /** source: { el, w, h, kind: 'camera' | 'photo' } */
  async setSource(source) {
    this.source = source;
    this.people.clear(); this.objects.clear(); this.clearProps();
    const tex = source.kind === 'camera' ? new THREE.VideoTexture(source.el) : new THREE.Texture(source.el);
    tex.colorSpace = THREE.NoColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    if (this.sourceTex) this.sourceTex.dispose();
    this.sourceTex = tex; this.quad.material.uniforms.tSource.value = tex; this.copy.material.uniforms.tSource.value = tex;
    this.updateMapping();
    if (this.vision.ready) await this.vision.setMode(source.kind === 'camera' ? 'VIDEO' : 'IMAGE');
    this.stillDone = false;
  }

  setProfile(p) {
    const changed = !this.profile || this.profile.era.key !== p.era.key || this.profile.region !== p.region;
    this.profile = p;
    if (changed) { this.clearProps(); for (const t of this.people.tracks) t.costume = null; this.stillDone = false; }
  }
  setLayers(l) { this.layers = { ...l }; }

  resize(W, H, dpr) {
    this.W = W; this.H = H; this.dpr = dpr;
    this.propsRT.setSize(Math.round(W * dpr), Math.round(H * dpr));
    const cd = Math.min(dpr, 2); this.costumeCanvas.width = Math.round(W * cd); this.costumeCanvas.height = Math.round(H * cd); this.cScale = cd;
    // GPU textures have a fixed size: a resized canvas needs a new texture.
    this.costumeTex.dispose(); this.costumeTex = new THREE.CanvasTexture(this.costumeCanvas); this.costumeTex.colorSpace = THREE.NoColorSpace;
    this.quad.material.uniforms.tCostume.value = this.costumeTex;
    this.propCam.left = 0; this.propCam.right = W; this.propCam.top = H; this.propCam.bottom = 0; this.propCam.updateProjectionMatrix();
    this.quad.material.uniforms.res.value.set(W * dpr, H * dpr);
    this.updateMapping();
  }

  /** Map screen uv to source uv: cover for the camera, contain for photos. */
  updateMapping() {
    if (!this.source) return;
    const sa = this.source.w / this.source.h, ra = this.W / this.H, m = this.quad.material.uniforms.srcMap.value;
    const contain = this.source.kind === 'photo';
    if ((sa > ra) !== contain) { const sx = ra / sa; m.set(sx, 1, (1 - sx) / 2, 0); }
    else { const sy = sa / ra; m.set(1, sy, 0, (1 - sy) / 2); }
  }
  /** Normalized source coordinates (y down) to screen CSS pixels. */
  toScreen = (nx, ny) => {
    const m = this.quad.material.uniforms.srcMap.value;
    const u = (nx - m.z) / m.x, v = ((1 - ny) - m.w) / m.y;
    return { x: u * this.W, y: (1 - v) * this.H };
  };
  boxToScreen(b) { const a = this.toScreen(b.x, b.y), c = this.toScreen(b.x + b.w, b.y + b.h); return { x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y }; }

  get active() { return !!this.source && !!this.profile; }
  get transforming() { return this.profile && this.profile.era.key !== 'now'; }

  runVision(ts) {
    const s = this.source, v = this.vision;
    if (!v.ready || !this.transforming) return;
    if (s.kind === 'photo') {
      if (this.stillDone) return;
      v.analyze(s.el, s.w, s.h, ts, { detectObjects: true, workWidth: 960 });
      this.stillDone = true;
    } else {
      if (s.el.readyState < 2) return;
      const every = this.visionMs > 28 ? 2 : 1;
      if (this.frameNo % every) return;
      const t0 = performance.now();
      v.analyze(s.el, s.w, s.h, ts, { detectObjects: this.frameNo % (every * 3) === 0 });
      this.visionMs = this.visionMs * 0.9 + (performance.now() - t0) * 0.1;
    }
    this.people.update(v.people.map((p) => ({ label: 'person', box: p.box, score: 1, data: p })));
    this.objects.update(v.objects.filter((o) => o.label !== 'person').map((o) => ({ ...o, data: o })));
    const m = v.mask;
    if (m.data && m.version !== this._maskVersion) {
      this._maskVersion = m.version;
      if (this.maskTex.image.width !== m.w || this.maskTex.image.height !== m.h) {
        this.maskTex.dispose(); this.maskTex = new THREE.DataTexture(m.data, m.w, m.h, THREE.RGBAFormat);
        this.maskTex.magFilter = this.maskTex.minFilter = THREE.LinearFilter; this.quad.material.uniforms.tMask.value = this.maskTex;
      } else this.maskTex.image.data = m.data;
      this.maskTex.needsUpdate = true;
    }
  }

  /** What each detection becomes in this era. */
  mappingFor(label) {
    const p = this.profile;
    if (VEHICLES.has(label)) return this.layers.transport ? (p.transport[label] ?? null) : null;
    return this.layers.furniture ? (p.furniture[label] ?? null) : null;
  }

  clearProps() { for (const [, pr] of this.props) this.propScene.remove(pr.holder); this.props.clear(); }

  updateProps(dt, time) {
    const seen = new Set(); const erase = []; const summary = [];
    const people = this.people.tracks.filter((t) => t.missed < 3);
    for (const t of this.objects.tracks) {
      const kind = this.mappingFor(t.label);
      const box = this.boxToScreen(t.box);
      if (!kind || box.w < 12 || box.h < 12) continue;
      const rider = VEHICLES.has(t.label) && ['motorcycle', 'bicycle'].includes(t.label) && people.some((p) => this.overlaps(p.box, t.box, 0.25));
      const sitter = ['bench', 'chair'].includes(t.label) && people.some((p) => this.overlaps(p.box, t.box, 0.2));
      const finalKind = rider ? (this.profile.transport.mount || kind) : kind;
      summary.push({ from: t.label, to: finalKind, rider, sitter, id: t.id });
      erase.push(t.box);
      if (finalKind === 'remove') continue;
      seen.add(t.id);
      let pr = this.props.get(t.id);
      if (!pr || pr.kind !== finalKind) {
        if (pr) this.propScene.remove(pr.holder);
        const model = buildProp(finalKind); if (!model) continue;
        const holder = new THREE.Group(); holder.add(model.group);
        const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0.7 }));
        shadow.renderOrder = -1; holder.add(shadow);
        pr = { kind: finalKind, model, holder, shadow, facing: 1, view: null };
        this.props.set(t.id, pr); this.propScene.add(holder);
      }
      // Metres-to-pixels from the detected object's real height, then turn the model until its
      // width matches the box; face the way it moves.
      if (Math.abs(t.vx) > 0.0015) pr.facing = Math.sign(t.vx);
      let s = box.h / (REAL_H[t.label] || pr.model.height);
      const angle = this.bestAngle(pr, box.w / s);
      const view = `${angle}:${pr.facing}`;
      if (pr.view !== view) {
        pr.view = view;
        const yaw = -(angle * Math.PI / 180);
        pr.model.group.rotation.set(0.12, pr.facing > 0 ? yaw : Math.PI - yaw, 0);
        pr.bounds = new THREE.Box3().setFromObject(pr.model.group);
      }
      const size = pr.bounds.getSize(new THREE.Vector3());
      s = Math.min(s, box.w * 1.25 / size.x, box.h * 1.6 / size.y);
      pr.holder.scale.setScalar(s);
      const cx = (pr.bounds.min.x + pr.bounds.max.x) / 2;
      const hover = pr.model.hover ? Math.sin(time * 2 + t.id) * 0.04 + pr.model.hover : 0;
      pr.holder.position.set(box.x + box.w / 2 - cx * s, this.H - (box.y + box.h) - pr.bounds.min.y * s + hover * s, 0);
      pr.shadow.scale.set(size.x * 1.05, Math.max(0.25, size.z * 0.35), 1); pr.shadow.position.set(cx, pr.bounds.min.y + 0.02, -size.z);
      pr.holder.visible = t.missed < 6;
      const moving = Math.abs(t.vx) > 0.0015, ph = time * 7 + t.id;
      for (const [i, leg] of (pr.model.legs || []).entries()) leg.rotation.z = moving ? Math.sin(ph + (i % 2) * Math.PI + (i > 1 ? 0.6 : 0)) * 0.45 : 0;
      for (const w of pr.model.wheels || []) w.rotation.z -= moving ? t.vx * 400 * dt * pr.facing : 0;
    }
    for (const [id, pr] of this.props) if (!seen.has(id)) { this.propScene.remove(pr.holder); this.props.delete(id); }
    const u = this.quad.material.uniforms; u.eraseN.value = Math.min(erase.length, MAX_ERASE);
    erase.slice(0, MAX_ERASE).forEach((b, i) => {
      const s = this.boxToScreen({ x: b.x - b.w * 0.04, y: b.y - b.h * 0.04, w: b.w * 1.08, h: b.h * 1.08 });
      u.erase.value[i].set(s.x / this.W, 1 - (s.y + s.h) / this.H, s.w / this.W, s.h / this.H);
    });
    this.summaryObjects = summary;
  }

  /** Yaw (15 = nearly side-on, 90 = facing the camera) whose on-screen width in metres is closest to `width`. */
  bestAngle(pr, width) {
    const aspect = width;
    if (!pr.aspects) {
      pr.aspects = [];
      for (let a = 15; a <= 90; a += 15) {
        pr.model.group.rotation.set(0.12, -(a * Math.PI / 180), 0);
        const s = new THREE.Box3().setFromObject(pr.model.group).getSize(new THREE.Vector3());
        pr.aspects.push([a, s.x]);
      }
    }
    let best = pr.aspects[0];
    for (const c of pr.aspects) if (Math.abs(Math.log(c[1] / aspect)) < Math.abs(Math.log(best[1] / aspect))) best = c;
    if (pr.angle !== undefined && Math.abs(best[0] - pr.angle) <= 15) {
      const cur = pr.aspects.find((c) => c[0] === pr.angle);
      if (cur && Math.abs(Math.log(cur[1] / aspect)) < Math.abs(Math.log(best[1] / aspect)) + 0.08) return pr.angle;
    }
    pr.angle = best[0]; return best[0];
  }

  overlaps(a, b, minFrac) {
    const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return x * y > minFrac * Math.min(a.w * a.h, b.w * b.h);
  }

  updatePeople() {
    const u = this.quad.material.uniforms, ctx = this.cctx, cs = this.cScale;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.costumeCanvas.width, this.costumeCanvas.height);
    for (let i = 0; i < 4; i++) u.pOn.value[i] = 0;
    const list = [];
    if (this.layers.people && this.profile.costumes.length) {
      for (const t of this.people.tracks) {
        if (t.missed > 2) continue;
        if (!t.costume) t.costume = pickVariant(this.profile.costumes, t.id);
        list.push({ id: t.id, landmarks: t.data.landmarks, costume: t.costume, channel: t.data.channel, fade: 1 - t.missed / 3 });
      }
      ctx.setTransform(cs, 0, 0, cs, 0, 0);
      drawCostumes(ctx, list, this.toScreen, this.light);
      this.costumeTex.needsUpdate = true;
      const d = this.dpr;
      for (const p of list) {
        const b = p.geometry || bodyGeometry(p.landmarks, this.toScreen); if (!b || p.channel >= MAX_PEOPLE || p.fade < 1) continue;
        const i = p.channel; u.pOn.value[i] = 1;
        const c = p.costume, palette = (c.recolor && c.recolor.length ? c.recolor : c.fabric || ['#5a4a38']);
        u.pColor.value[i].copy(hexToVec(palette[p.id % palette.length]));
        u.pShoulder.value[i] = b.midS.y * d; u.pSw.value[i] = b.sw * d;
        u.pHead.value[i].set(b.head.c.x * d, b.head.c.y * d, b.head.r * d);
        const w1 = b.pts.wrL, w2 = b.pts.wrR;
        u.pWrists.value[i].set(w1.v > 0.3 ? w1.x * d : -1e4, w1.y * d, w2.v > 0.3 ? w2.x * d : -1e4, w2.y * d);
      }
    } else this.costumeTex.needsUpdate = true;
    this.summaryPeople = list.map((p) => p.costume);
  }

  estimateLight() {
    if (this.frameNo % 20) return;
    const r = this.renderer; r.setRenderTarget(this.lightRT); r.render(this.copyScene, this.ortho);
    r.readRenderTargetPixels(this.lightRT, 0, 0, 8, 8, this.lightBuf);
    let R = 0, G = 0, B = 0; for (let i = 0; i < 256; i += 4) { R += this.lightBuf[i]; G += this.lightBuf[i + 1]; B += this.lightBuf[i + 2]; }
    R /= 64 * 255; G /= 64 * 255; B /= 64 * 255;
    const l = 0.299 * R + 0.587 * G + 0.114 * B;
    this.light = Math.min(1, Math.max(0.3, l * 2.1));
    const tint = new THREE.Color(R + 0.3, G + 0.3, B + 0.3);
    this.hemi.color.copy(tint); this.hemi.intensity = 0.5 + this.light * 1.3; this.sun.intensity = 0.6 + this.light * 2.2;
  }

  render(dt, time) {
    if (!this.active) return;
    this.frameNo++;
    const r = this.renderer, u = this.quad.material.uniforms;
    if (this.source.kind === 'camera' && this.source.el.videoWidth && (this.source.el.videoWidth !== this.source.w || this.source.el.videoHeight !== this.source.h)) {
      this.source.w = this.source.el.videoWidth; this.source.h = this.source.el.videoHeight; this.updateMapping();
    }
    this.runVision(performance.now());
    r.setRenderTarget(this.blurRT); r.render(this.copyScene, this.ortho);
    this.estimateLight();
    if (this.transforming) { this.updateProps(dt, time); this.updatePeople(); }
    else { this.clearProps(); u.eraseN.value = 0; for (let i = 0; i < 4; i++) u.pOn.value[i] = 0; this.cctx.clearRect(0, 0, this.costumeCanvas.width, this.costumeCanvas.height); this.costumeTex.needsUpdate = true; this.summaryObjects = []; this.summaryPeople = []; }
    r.setRenderTarget(this.propsRT); r.setClearColor(0x000000, 0); r.clear(); r.render(this.propScene, this.propCam);
    u.time.value = time;
    u.grade.value = GRADES[this.profile.grade] || 0;
    u.gradeAmt.value = this.layers.grade ? 1 : 0;
    u.transform.value = this.transforming ? 1 : 0;
    u.lensOn.value = this.lens.on ? 1 : 0;
    u.lensC.value.set(this.lens.x * this.dpr, this.lens.y * this.dpr); u.lensR.value = this.lens.r * this.dpr;
    r.setRenderTarget(null); r.render(this.quadScene, this.ortho);
  }

  /** Hebrew list of what was recognised and what it became, for the HUD. */
  describe() {
    const out = [];
    const n = (this.summaryPeople || []).length;
    if (n) out.push(`${n === 1 ? 'אדם אחד' : n + ' אנשים'} → ${[...new Set(this.summaryPeople.map(costumeName))].join(', ')}`);
    const LBL = { car: 'מכונית', motorcycle: 'אופנוע', bicycle: 'אופניים', bus: 'אוטובוס', truck: 'משאית', bench: 'ספסל', chair: 'כיסא', 'traffic light': 'רמזור', 'fire hydrant': 'ברז כיבוי', 'stop sign': 'תמרור', 'parking meter': 'מדחן' };
    for (const o of this.summaryObjects || []) out.push(`${LBL[o.from] || o.from}${o.rider ? ' עם רוכב' : ''}${o.sitter ? ' עם יושב' : ''} → ${PROP_NAMES[o.to] || o.to}`);
    return out;
  }

  /** The detections as plain data, for the AI prompt. */
  sceneFacts() {
    const people = this.people.tracks.filter((t) => t.missed < 3);
    const pos = (b) => { const c = b.x + b.w / 2; return c < 0.35 ? 'on the left' : c > 0.65 ? 'on the right' : 'in the centre'; };
    return {
      people: people.map((p) => ({ where: pos(p.box), sitting: this.objects.tracks.some((o) => ['bench', 'chair'].includes(o.label) && this.overlaps(p.box, o.box, 0.2)), riding: this.objects.tracks.some((o) => ['motorcycle', 'bicycle'].includes(o.label) && this.overlaps(p.box, o.box, 0.25)) })),
      objects: this.objects.tracks.filter((t) => t.missed < 3).map((o) => ({ label: o.label, where: pos(o.box), becomes: this.mappingFor(o.label) })),
    };
  }
}

function costumeName(c) {
  if (!c) return '';
  const G = { robe: 'גלביה', dress: 'שמלה ארוכה', coat: 'מעיל', suit: 'חליפה', none: 'צבעי התקופה' };
  const H = { tarbush: 'תרבוש', keffiyeh: 'כאפייה', fedora: 'פדורה', flatcap: 'כובע מצחייה', tophat: 'צילינדר', bowler: 'מגבעת', cowboy: 'כובע רחב שוליים', bonnet: 'מצנפת', headscarf: 'כיסוי ראש', cloche: 'כובע קלוש', kova: 'כובע טמבל', visor: 'משקפי AR' };
  return [G[c.garment], H[c.headwear]].filter(Boolean).join(' + ');
}
