// The camera view, rebuilt live for the chosen era. Using the scene map from scene.js, every
// region of the frame is re-made: the sky becomes a period sky, walls turn to cut stone or
// plaster, asphalt to a dirt road or cobblestones (in perspective), pavements to slabs or
// earth, vehicles and modern clutter are erased into what surrounds them, and people's clothes
// take period colours. The real light and shadows of the camera are kept on every material,
// and the whole picture gets the photographic look of the era. The X-ray lens shows the present.
import * as THREE from 'three';

const GRADES = { none: 0, albumen: 1, ortho: 2, kodachrome: 3, future: 4 };
const hex = (h) => { const n = parseInt(h.slice(1), 16); return new THREE.Vector3((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

const shader = {
  uniforms: {
    tCam: { value: null }, tBlur: { value: null }, tResult: { value: null }, tSegA: { value: null }, tSegB: { value: null },
    camMap: { value: new THREE.Vector4(1, 1, 0, 0) }, resMap: { value: new THREE.Vector4(1, 1, 0, 0) }, vidSize: { value: new THREE.Vector2(1280, 720) },
    resultMix: { value: 0 }, grade: { value: 0 }, res: { value: new THREE.Vector2(1, 1) }, time: { value: 0 },
    lensOn: { value: 0 }, lensC: { value: new THREE.Vector2() }, lensR: { value: 200 },
    sceneOn: { value: 0 }, horizon: { value: 0.45 },
    wallStyle: { value: 0 }, roadStyle: { value: 0 }, walkStyle: { value: 0 },
    wallColor: { value: new THREE.Vector3() }, roadColor: { value: new THREE.Vector3() }, walkColor: { value: new THREE.Vector3() },
    haze: { value: 0.5 }, plantK: { value: 1 }, cloth: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, clothN: { value: 3 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tCam, tBlur, tResult, tSegA, tSegB;
    uniform vec4 camMap, resMap; uniform vec2 res, lensC, vidSize;
    uniform float resultMix, time, lensOn, lensR, sceneOn, horizon, haze, plantK;
    uniform int grade, wallStyle, roadStyle, walkStyle, clothN;
    uniform vec3 wallColor, roadColor, walkColor; uniform vec3 cloth[4];
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec2 hash2(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
    float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

    // ---- period materials (p in video pixels) ----
    vec3 wall(vec2 p){
      if (wallStyle == 0) { // cut stone courses
        float bh = 20.0, row = floor(p.y / bh);
        vec2 q = vec2(p.x / 44.0 + mod(row, 2.0) * 0.5, p.y / bh), c = floor(q), f = fract(q);
        float joint = smoothstep(0.0, 0.05, f.x) * smoothstep(1.0, 0.95, f.x) * smoothstep(0.0, 0.09, f.y) * smoothstep(1.0, 0.91, f.y);
        float tone = 0.86 + 0.26 * hash(c) + 0.18 * (fbm(p * 0.09) - 0.5);
        return mix(wallColor * 0.62, wallColor * tone, joint);
      }
      if (wallStyle == 1) return wallColor * (0.9 + 0.16 * fbm(p * 0.012) + 0.08 * (fbm(p * 0.25) - 0.5)) - vec3(0.06, 0.05, 0.03) * smoothstep(0.62, 0.8, fbm(p * 0.006 + 3.0));
      if (wallStyle == 2) { float seam = step(0.97, fract(p.y / 110.0)) + step(0.985, fract(p.x / 160.0)); return wallColor * (0.84 + 0.24 * fbm(p * 0.05)) * (1.0 - seam * 0.25); }
      vec2 g = fract(p / vec2(90.0, 60.0)); float panel = smoothstep(0.0, 0.03, g.x) * smoothstep(0.0, 0.05, g.y);
      vec3 c = wallColor * (0.9 + 0.1 * panel);
      return mix(c, vec3(0.31, 0.52, 0.33) * (0.7 + 0.5 * fbm(p * 0.05)), smoothstep(0.55, 0.7, fbm(p * 0.008 + 7.0)));
    }
    // Ground plane in perspective from the horizon line.
    vec2 groundUV(vec2 v){ float gy = max(v.y - horizon, 0.004); float z = 0.08 / gy; return vec2((v.x - 0.5) * z * vidSize.x / vidSize.y, z); }
    vec3 road(vec2 v){
      vec2 g = groundUV(v); float far = smoothstep(0.6, 6.0, g.y);
      vec3 c;
      if (roadStyle == 0) { // dirt with wheel ruts and pebbles
        float rut = smoothstep(0.08, 0.0, abs(abs(g.x) - 0.55)) * 0.18;
        c = roadColor * (0.8 + 0.4 * fbm(g * vec2(4.0, 2.0)) - rut);
        c *= 1.0 - 0.25 * step(0.93, hash(floor(g * 40.0))) * (1.0 - far);
      } else if (roadStyle == 1) { // cobblestones
        vec2 q = g * vec2(9.0, 9.0), i = floor(q), f = fract(q); float d = 9.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 o = vec2(x, y); vec2 r = o + 0.5 + 0.35 * (hash2(i + o) - 0.5) - f; d = min(d, dot(r, r)); }
        float stone = smoothstep(0.32, 0.12, d);
        c = mix(roadColor * 0.45, roadColor * (0.85 + 0.35 * hash(i + floor(q))), stone);
      } else if (roadStyle == 2) { // worn asphalt with a faded line
        c = roadColor * (0.82 + 0.3 * fbm(g * 12.0)); c = mix(c, vec3(0.85, 0.82, 0.7), smoothstep(0.04, 0.0, abs(g.x)) * step(0.5, fract(g.y * 0.8)) * 0.6);
      } else { // smart road with light lanes
        c = roadColor * (0.9 + 0.15 * fbm(g * 8.0)); c += vec3(0.3, 0.95, 0.9) * smoothstep(0.03, 0.0, abs(abs(g.x) - 0.9)) * 0.8;
      }
      return mix(c, roadColor * 0.95, far);
    }
    vec3 walk(vec2 v){
      vec2 g = groundUV(v) * 3.0; float far = smoothstep(2.0, 18.0, g.y);
      if (walkStyle == 0) return mix(walkColor * (0.85 + 0.3 * fbm(g * 2.0)), walkColor, far);
      vec2 f = fract(g); float gap = smoothstep(0.0, 0.04, f.x) * smoothstep(0.0, 0.04, f.y);
      return mix(mix(walkColor * 0.6, walkColor * (0.9 + 0.2 * hash(floor(g))), gap), walkColor, far);
    }
    vec3 sky(vec2 v, vec3 bl){
      float t = clamp(v.y / max(horizon, 0.05), 0.0, 1.0);
      vec3 top = mix(vec3(0.55, 0.68, 0.84), vec3(0.86, 0.85, 0.8), haze), hor = mix(vec3(0.82, 0.86, 0.9), vec3(0.95, 0.92, 0.86), haze);
      vec3 c = mix(top, hor, t);
      float cl = smoothstep(0.45, 0.8, fbm(v * vec2(5.0, 9.0) + vec2(time * 0.01, 0.0)));
      c = mix(c, vec3(0.97, 0.96, 0.94), cl * 0.65);
      return c * clamp(lum(bl) * 1.3 + 0.2, 0.25, 1.15);
    }

    vec3 applyGrade(vec3 c, vec2 uv, int g){
      float n = hash(uv * res + fract(time * 13.0) * 100.0) - 0.5;
      vec2 q = uv - 0.5; float vig = clamp(1.0 - dot(q, q) * 1.6, 0.0, 1.0);
      if (g == 1) {
        float l = mix(0.5, lum(c), 0.8) + 0.03;
        vec3 s = vec3(l) * vec3(1.13, 0.96, 0.72) + vec3(0.05, 0.025, -0.01);
        s = mix(s, vec3(0.93, 0.86, 0.72), smoothstep(0.75, 1.1, l) * 0.5) * mix(0.55, 1.0, vig);
        vec2 cell = floor(uv * 60.0); vec2 f = fract(uv * 60.0) - 0.5;
        s = mix(s, vec3(0.25, 0.18, 0.12), step(0.993, hash(cell + floor(time * 3.0))) * smoothstep(0.18, 0.0, length(f)) * 0.6);
        return s + n * 0.07;
      }
      if (g == 2) {
        float l = smoothstep(0.03, 0.97, dot(c, vec3(0.12, 0.43, 0.45))) * (0.97 + 0.03 * sin(time * 23.0)) * mix(0.6, 1.0, vig);
        float sx = hash(vec2(floor(time * 9.0), 7.0));
        l = mix(l, 0.85, smoothstep(0.0015, 0.0, abs(uv.x - sx)) * step(0.6, hash(vec2(floor(time * 9.0), 3.0))) * 0.6);
        return vec3(l + n * 0.09) * vec3(1.0, 0.99, 0.96);
      }
      if (g == 3) { float l = lum(c); vec3 s = c * vec3(1.08, 1.0, 0.84) + (1.0 - l) * vec3(-0.01, 0.025, 0.045); return (mix(vec3(l), s, 1.12) * 0.88 + 0.07) * mix(0.8, 1.0, vig) + n * 0.035; }
      if (g == 4) { vec3 s = c * vec3(0.93, 1.02, 1.07); return mix(vec3(lum(s)), s, 1.08) + n * 0.012; }
      return c;
    }

    void main(){
      vec2 uv = vUv; vec2 px = vec2(uv.x * res.x, (1.0 - uv.y) * res.y);
      vec2 vu = uv * camMap.xy + camMap.zw;           // video uv (y up)
      vec2 vd = vec2(vu.x, 1.0 - vu.y);               // video uv (y down)
      vec2 vp = vd * vidSize;                         // video pixels
      vec3 cam = texture2D(tCam, vu).rgb, bl = texture2D(tBlur, vu).rgb;
      vec3 col = cam;
      if (sceneOn > 0.5) {
        vec4 A = texture2D(tSegA, vd), B = texture2D(tSegB, vd);
        float removed = B.b;
        // Keep the camera's light and shading on the new materials; erased areas get the smooth light around them.
        float shade = clamp(lum(cam) / max(lum(bl), 0.04), 0.35, 1.9);
        float expo = clamp(lum(bl) * 1.25 + 0.15, 0.2, 1.2);
        float sw = mix(pow(shade, 0.75), 1.0, removed), sr = mix(pow(shade, 0.9), 1.0, removed);
        vec3 W = wall(vp) * expo * 1.15 * sw;
        vec3 R = road(vd) * expo * 1.15 * sr;
        vec3 K = walk(vd) * expo * 1.15 * sr;
        vec3 S = sky(vd, bl);
        float pl = lum(cam); vec3 P = mix(vec3(pl), cam, plantK) * vec3(0.98, 1.0, 0.95);
        // People: dye clothing in period colours, keep skin.
        float skin = smoothstep(0.04, 0.1, cam.r - cam.b) * step(cam.b, cam.g) * step(cam.g, cam.r) * smoothstep(0.2, 0.4, lum(cam)) * smoothstep(0.9, 0.7, lum(cam));
        int ci = int(mod(floor(vd.x * 7.0), float(clothN)));
        vec3 cc = cloth[0]; if (ci == 1) cc = cloth[1]; if (ci == 2) cc = cloth[2]; if (ci == 3) cc = cloth[3];
        vec3 H = mix(cc * (0.3 + lum(cam) * 1.5), cam, skin);
        float other = B.a;
        float tot = A.r + A.g + A.b + A.a + B.r + B.g + other + 1e-4;
        col = (S * A.r + W * A.g + R * A.b + K * A.a + P * B.r + H * B.g + cam * other) / tot;
      }
      vec3 live = applyGrade(col, uv, grade);
      vec3 past = texture2D(tResult, uv * resMap.xy + resMap.zw).rgb;
      col = mix(live, past, resultMix);
      float d = distance(px, lensC);
      float inside = lensOn * (1.0 - smoothstep(lensR - 1.5, lensR + 1.5, d));
      col = mix(col, cam, inside);
      float ring = lensOn * (smoothstep(lensR - 1.0, lensR + 1.0, d) - smoothstep(lensR + 5.0, lensR + 7.5, d));
      vec2 dv = px - lensC;
      col = mix(col, vec3(0.85, 0.64, 0.36) * (0.8 + 0.2 * sin(atan(dv.y, dv.x) * 2.0 + time * 0.6)), ring);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const copyShader = {
  uniforms: { tCam: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D tCam; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tCam, vUv).rgb, 1.0); }',
};

/** Screen uv → texture uv so a w×h picture covers the screen (crop, no stretching). */
function cover(out, w, h, W, H) {
  const sa = w / h, ra = W / H;
  if (sa > ra) { const sx = ra / sa; out.set(sx, 1, (1 - sx) / 2, 0); } else { const sy = sa / ra; out.set(1, sy, 0, (1 - sy) / 2); }
}
function dataTex(w, h, data) { const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; }

export class LiveView {
  constructor(renderer) {
    this.renderer = renderer;
    this.mat = new THREE.ShaderMaterial({ ...shader, depthTest: false, depthWrite: false });
    this.scene = new THREE.Scene(); this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
    this.copy = new THREE.ShaderMaterial({ ...copyShader, depthTest: false });
    this.copyScene = new THREE.Scene(); this.copyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copy));
    this.blurRT = new THREE.WebGLRenderTarget(48, 27);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.video = null; this.W = 1; this.H = 1; this.dpr = 1;
    this.result = null; this.target = 0; this.mix = 0; this.segVersion = -1; this.sceneParams = null;
    this.lens = { on: false, x: 0, y: 0, r: 150 };
    const u = this.mat.uniforms, black = new Uint8Array([0, 0, 0, 255]);
    u.tResult.value = dataTex(1, 1, black); u.tSegA.value = dataTex(1, 1, new Uint8Array(4)); u.tSegB.value = dataTex(1, 1, new Uint8Array([0, 0, 0, 255]));
    u.tBlur.value = this.blurRT.texture;
  }
  setVideo(video) {
    this.video = video;
    const t = new THREE.VideoTexture(video); t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    this.mat.uniforms.tCam.value = t; this.copy.uniforms.tCam.value = t;
  }
  /** Era look: `grade` name and the scene rebuild parameters (null = today, show the camera). */
  setEra(grade, scene) {
    const u = this.mat.uniforms; u.grade.value = GRADES[grade] || 0; this.sceneParams = scene;
    if (!scene) return;
    u.wallStyle.value = scene.wall; u.roadStyle.value = scene.road; u.walkStyle.value = scene.walk;
    u.wallColor.value.copy(hex(scene.wallColor)); u.roadColor.value.copy(hex(scene.roadColor)); u.walkColor.value.copy(hex(scene.walkColor));
    u.haze.value = scene.haze; u.plantK.value = scene.plant;
    scene.cloth.slice(0, 4).forEach((c, i) => u.cloth.value[i].copy(hex(c))); u.clothN.value = Math.min(4, scene.cloth.length);
  }
  /** Feed the latest scene map from SceneParser. */
  setSegmentation(parser) {
    if (!parser || parser.version === this.segVersion || !parser.a) return;
    this.segVersion = parser.version;
    const u = this.mat.uniforms;
    for (const [key, data] of [['tSegA', parser.a], ['tSegB', parser.b]]) {
      const t = u[key].value;
      if (t.image.width !== parser.w || t.image.height !== parser.h) { t.dispose(); u[key].value = dataTex(parser.w, parser.h, data); }
      else { t.image.data = data; t.needsUpdate = true; }
    }
    u.horizon.value = parser.horizon; this.segReady = true;
  }
  resize(W, H, dpr) { this.W = W; this.H = H; this.dpr = dpr; this.mat.uniforms.res.value.set(W * dpr, H * dpr); }

  showResult(img) {
    const t = new THREE.Texture(img); t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
    if (this.result) this.result.texture.dispose();
    this.result = { texture: t, w: img.naturalWidth, h: img.naturalHeight };
    this.mat.uniforms.tResult.value = t; this.mix = 0; this.target = 1;
  }
  clearResult() { this.target = 0; }
  get showingResult() { return this.target === 1 && !!this.result; }

  render(dt, time) {
    if (!this.video) return;
    const u = this.mat.uniforms, v = this.video, r = this.renderer;
    if (v.videoWidth) { cover(u.camMap.value, v.videoWidth, v.videoHeight, this.W, this.H); u.vidSize.value.set(v.videoWidth, v.videoHeight); }
    if (this.result) cover(u.resMap.value, this.result.w, this.result.h, this.W, this.H);
    this.mix += (this.target - this.mix) * Math.min(1, dt * 3);
    u.resultMix.value = this.mix; u.time.value = time;
    u.sceneOn.value = this.sceneParams && this.segReady ? 1 : 0;
    u.lensOn.value = this.lens.on ? 1 : 0; u.lensC.value.set(this.lens.x * this.dpr, this.lens.y * this.dpr); u.lensR.value = this.lens.r * this.dpr;
    r.setRenderTarget(this.blurRT); r.render(this.copyScene, this.cam);
    r.setRenderTarget(null); r.render(this.scene, this.cam);
  }

  /** The current camera frame, cropped exactly as it is on screen, as a JPEG data URL. */
  capture(maxSide = 1024) {
    const v = this.video, m = new THREE.Vector4(); cover(m, v.videoWidth, v.videoHeight, this.W, this.H);
    const sw = v.videoWidth * m.x, sh = v.videoHeight * m.y, sx = v.videoWidth * m.z, sy = v.videoHeight * m.w;
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    const c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  }
}
