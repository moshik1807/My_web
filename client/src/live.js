// The camera view. Live frames get the era's photographic look on the device (no recognition,
// the whole frame). When the AI has rebuilt the scene, its picture replaces the camera, and the
// X-ray lens shows the present through it.
import * as THREE from 'three';

const GRADES = { none: 0, albumen: 1, ortho: 2, kodachrome: 3, future: 4 };

const shader = {
  uniforms: {
    tCam: { value: null }, tResult: { value: null }, camMap: { value: new THREE.Vector4(1, 1, 0, 0) }, resMap: { value: new THREE.Vector4(1, 1, 0, 0) },
    resultMix: { value: 0 }, grade: { value: 0 }, res: { value: new THREE.Vector2(1, 1) }, time: { value: 0 },
    lensOn: { value: 0 }, lensC: { value: new THREE.Vector2() }, lensR: { value: 200 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tCam, tResult; uniform vec4 camMap, resMap; uniform vec2 res, lensC;
    uniform float resultMix, time, lensOn, lensR; uniform int grade;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    vec3 applyGrade(vec3 c, vec2 uv, int g){
      float n = hash(uv * res + fract(time * 13.0) * 100.0) - 0.5;
      vec2 q = uv - 0.5; float vig = clamp(1.0 - dot(q, q) * 1.6, 0.0, 1.0);
      if (g == 1) { // 1880s albumen print
        float l = mix(0.5, lum(c), 0.8) + 0.03;
        vec3 s = vec3(l) * vec3(1.13, 0.96, 0.72) + vec3(0.05, 0.025, -0.01);
        s = mix(s, vec3(0.93, 0.86, 0.72), smoothstep(0.75, 1.1, l) * 0.5);
        s *= mix(0.55, 1.0, vig);
        vec2 cell = floor(uv * 60.0); vec2 f = fract(uv * 60.0) - 0.5;
        s = mix(s, vec3(0.25, 0.18, 0.12), step(0.993, hash(cell + floor(time * 3.0))) * smoothstep(0.18, 0.0, length(f)) * 0.6);
        return s + n * 0.07;
      }
      if (g == 2) { // 1920s orthochromatic black and white
        float l = smoothstep(0.03, 0.97, dot(c, vec3(0.12, 0.43, 0.45)));
        l *= (0.97 + 0.03 * sin(time * 23.0)) * mix(0.6, 1.0, vig);
        float sx = hash(vec2(floor(time * 9.0), 7.0));
        l = mix(l, 0.85, smoothstep(0.0015, 0.0, abs(uv.x - sx)) * step(0.6, hash(vec2(floor(time * 9.0), 3.0))) * 0.6);
        return vec3(l + n * 0.09) * vec3(1.0, 0.99, 0.96);
      }
      if (g == 3) { // faded 1970s Kodachrome
        float l = lum(c);
        vec3 s = c * vec3(1.08, 1.0, 0.84) + (1.0 - l) * vec3(-0.01, 0.025, 0.045);
        s = mix(vec3(l), s, 1.12) * 0.88 + 0.07;
        return s * mix(0.8, 1.0, vig) + n * 0.035;
      }
      if (g == 4) { vec3 s = c * vec3(0.93, 1.02, 1.07); return mix(vec3(lum(s)), s, 1.08) + n * 0.012; }
      return c;
    }
    void main(){
      vec2 uv = vUv; vec2 px = vec2(uv.x * res.x, (1.0 - uv.y) * res.y);
      vec3 cam = texture2D(tCam, uv * camMap.xy + camMap.zw).rgb;
      vec3 live = applyGrade(cam, uv, grade);
      vec3 past = texture2D(tResult, uv * resMap.xy + resMap.zw).rgb;
      float n = hash(uv * res + fract(time * 7.0) * 50.0) - 0.5;
      past += n * (grade == 0 || grade == 4 ? 0.0 : 0.03);
      vec3 col = mix(live, past, resultMix);
      // X-ray lens: the present camera inside it.
      float d = distance(px, lensC);
      float inside = lensOn * (1.0 - smoothstep(lensR - 1.5, lensR + 1.5, d));
      col = mix(col, cam, inside);
      float ring = lensOn * (smoothstep(lensR - 1.0, lensR + 1.0, d) - smoothstep(lensR + 5.0, lensR + 7.5, d));
      vec2 dv = px - lensC;
      col = mix(col, vec3(0.85, 0.64, 0.36) * (0.8 + 0.2 * sin(atan(dv.y, dv.x) * 2.0 + time * 0.6)), ring);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** Screen uv → texture uv so a w×h picture covers the screen (crop, no stretching). */
function cover(out, w, h, W, H) {
  const sa = w / h, ra = W / H;
  if (sa > ra) { const sx = ra / sa; out.set(sx, 1, (1 - sx) / 2, 0); } else { const sy = sa / ra; out.set(1, sy, 0, (1 - sy) / 2); }
}

export class LiveView {
  constructor(renderer) {
    this.renderer = renderer;
    this.mat = new THREE.ShaderMaterial({ ...shader, depthTest: false, depthWrite: false });
    this.scene = new THREE.Scene(); this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.video = null; this.W = 1; this.H = 1; this.dpr = 1;
    this.result = null; this.target = 0; this.mix = 0;
    this.lens = { on: false, x: 0, y: 0, r: 150 };
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blank.needsUpdate = true;
    this.mat.uniforms.tResult.value = blank;
  }
  setVideo(video) {
    this.video = video;
    const t = new THREE.VideoTexture(video); t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    this.mat.uniforms.tCam.value = t;
  }
  setGrade(name) { this.mat.uniforms.grade.value = GRADES[name] || 0; }
  resize(W, H, dpr) { this.W = W; this.H = H; this.dpr = dpr; this.mat.uniforms.res.value.set(W * dpr, H * dpr); }

  /** Show an AI picture (an HTMLImageElement) over the camera, with a short crossfade. */
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
    const u = this.mat.uniforms, v = this.video;
    if (v.videoWidth) cover(u.camMap.value, v.videoWidth, v.videoHeight, this.W, this.H);
    if (this.result) cover(u.resMap.value, this.result.w, this.result.h, this.W, this.H);
    this.mix += (this.target - this.mix) * Math.min(1, dt * 3);
    u.resultMix.value = this.mix; u.time.value = time;
    u.lensOn.value = this.lens.on ? 1 : 0; u.lensC.value.set(this.lens.x * this.dpr, this.lens.y * this.dpr); u.lensR.value = this.lens.r * this.dpr;
    this.renderer.setRenderTarget(null); this.renderer.render(this.scene, this.cam);
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
