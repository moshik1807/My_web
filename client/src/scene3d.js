// 3D reconstruction of Jaffa's Clock Square across five eras: walkable, with NPCs, traffic,
// day/night and weather. Used when there is no camera, or to explore the demo site.
import * as THREE from 'three';

/* ---------------------------------------------------------------- utils */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function mulberry(seed) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function weighted(r, mix) {
  const keys = Object.keys(mix); let s = 0; for (const k of keys) s += mix[k];
  let x = r() * s; for (const k of keys) { x -= mix[k]; if (x <= 0) return k; } return keys[0];
}
const EARTH_R = 6378137;
function localToGeo(loc, x, z) {
  return { lat: loc.lat + (-z / EARTH_R) * 180 / Math.PI, lng: loc.lng + (x / (EARTH_R * Math.cos(loc.lat * Math.PI / 180))) * 180 / Math.PI };
}
/* ---------------------------------------------------------------- textures */
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function grain(g, w, h, n, alpha, r) {
  for (let i = 0; i < n; i++) {
    const v = r() > 0.5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
  }
}

const STYLES = {
  ottoman:   { floorH: 4.0, bayW: 3.2, walls: ['#d9c29b', '#cfb68c', '#e3d3b2', '#c9ab80'], shutters: ['#4f7a80', '#3d6b5a', '#6b4f3a'], kind: 'arch', lit: '#ffb866', roof: '#bfa57c', rough: 0.95, metal: 0 },
  mandate:   { floorH: 3.4, bayW: 3.4, walls: ['#ebe3d1', '#ddd2ba', '#f0e9da', '#d8c8a8'], shutters: ['#5b6e7d', '#8a5a3c', '#556b4f'], kind: 'rect', lit: '#ffc480', roof: '#a9573c', rough: 0.9, metal: 0 },
  brutalist: { floorH: 3.0, bayW: 3.0, walls: ['#9b9890', '#8d8a82', '#a7a39a'], kind: 'strip', lit: '#ffd9a0', roof: '#7d7a73', rough: 0.95, metal: 0 },
  glass:     { floorH: 3.6, bayW: 3.0, walls: ['#4a6478', '#56748a', '#3f5668'], kind: 'curtain', lit: '#7f96b3', roof: '#2f3b45', rough: 0.25, metal: 0.4 },
  future:    { floorH: 4.0, bayW: 3.6, walls: ['#2c4a52', '#334e5e', '#25404a'], kind: 'future', lit: '#7ff5e1', roof: '#1f3238', rough: 0.3, metal: 0.35 },
};

function facadeTextures(styleKey, variant) {
  const st = STYLES[styleKey]; const S = 256, C = 64;
  const r = mulberry(1000 + variant * 97 + styleKey.length * 13);
  const wall = st.walls[variant % st.walls.length];
  const shutter = st.shutters ? st.shutters[variant % st.shutters.length] : '#333';
  const litMask = []; for (let i = 0; i < 16; i++) litMask.push(r() < (styleKey === 'glass' ? 0.3 : styleKey === 'future' ? 0.45 : 0.38));
  const drawWin = (g, fill, emissive) => {
    for (let fy = 0; fy < 4; fy++) for (let bx = 0; bx < 4; bx++) {
      const x = bx * C, y = fy * C, lit = litMask[fy * 4 + bx];
      if (emissive && !lit) continue;
      const col = emissive ? st.lit : fill;
      g.fillStyle = col;
      if (st.kind === 'arch') {
        g.beginPath(); g.moveTo(x + 22, y + 56); g.lineTo(x + 22, y + 26); g.arc(x + 32, y + 26, 10, Math.PI, 0); g.lineTo(x + 42, y + 56); g.closePath(); g.fill();
        if (!emissive) { g.fillStyle = shutter; g.fillRect(x + 13, y + 20, 8, 36); g.fillRect(x + 43, y + 20, 8, 36); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, y + 60, C, 4); }
      } else if (st.kind === 'rect') {
        g.fillRect(x + 21, y + 14, 22, 36);
        if (!emissive) { g.fillStyle = shutter; g.fillRect(x + 14, y + 14, 6, 36); g.fillRect(x + 44, y + 14, 6, 36); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 19, y + 50, 26, 3); }
      } else if (st.kind === 'strip') {
        g.fillRect(x, y + 20, C, 24);
        if (!emissive) { g.fillStyle = 'rgba(200,200,190,0.5)'; for (let m = 0; m < 4; m++) g.fillRect(x + m * 16, y + 20, 2, 24); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, y + 44, C, 3); }
      } else if (st.kind === 'curtain') {
        g.fillRect(x + 2, y + 2, C - 4, C - 6);
      } else if (st.kind === 'future') {
        g.fillRect(x + 3, y + 4, C - 6, 40);
        if (!emissive) { g.fillStyle = '#4f8a5b'; g.fillRect(x, y + 48, C, 12); g.fillStyle = '#6fae6a'; for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(x + 4 + k * 9 + r() * 4, y + 49, 3 + r() * 3, 0, Math.PI * 2); g.fill(); } }
        else { g.fillStyle = '#4ff5e6'; g.fillRect(x, y + 45, C, 2); }
      }
    }
  };
  const map = canvasTex(S, S, (g) => {
    g.fillStyle = wall; g.fillRect(0, 0, S, S);
    grain(g, S, S, 1400, styleKey === 'glass' ? 0.05 : 0.12, r);
    if (styleKey === 'ottoman') { g.strokeStyle = 'rgba(80,60,30,0.12)'; for (let y = 0; y < S; y += 10) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); } }
    if (styleKey === 'glass') { const gr = g.createLinearGradient(0, 0, S, S); gr.addColorStop(0, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }
    const winFill = styleKey === 'glass' ? '#2a3d4d' : styleKey === 'future' ? '#14262c' : '#2a2520';
    drawWin(g, winFill, false);
    if (styleKey === 'glass') { g.strokeStyle = '#9fb2c0'; g.lineWidth = 2; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * C, 0); g.lineTo(i * C, S); g.stroke(); g.beginPath(); g.moveTo(0, i * C); g.lineTo(S, i * C); g.stroke(); } }
  });
  const emissive = canvasTex(S, S, (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, S, S); drawWin(g, '#000', true); });
  return { map, emissive };
}

function groundTex(kind) {
  const r = mulberry(kind.length * 31 + 7);
  return canvasTex(256, 256, (g, w, h) => {
    if (kind === 'dirt') { g.fillStyle = '#b89f77'; g.fillRect(0, 0, w, h); grain(g, w, h, 3000, 0.18, r); g.fillStyle = 'rgba(90,60,30,0.15)'; g.fillRect(0, 70, w, 16); g.fillRect(0, 170, w, 16); }
    else if (kind === 'cobble') { g.fillStyle = '#6f6458'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) { const v = 100 + r() * 50; g.fillStyle = `rgb(${v},${v * 0.92},${v * 0.82})`; g.beginPath(); g.ellipse(x + 8, y + 8, 7, 6.5, 0, 0, Math.PI * 2); g.fill(); } }
    else if (kind === 'asphalt') { g.fillStyle = '#4a4a4c'; g.fillRect(0, 0, w, h); grain(g, w, h, 4000, 0.12, r); }
    else if (kind === 'smart') { g.fillStyle = '#2a3236'; g.fillRect(0, 0, w, h); grain(g, w, h, 2000, 0.08, r); g.strokeStyle = 'rgba(127,216,208,0.18)'; for (let i = 0; i < w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); } }
    else if (kind === 'paving_old') { g.fillStyle = '#c9b48f'; g.fillRect(0, 0, w, h); grain(g, w, h, 2500, 0.15, r); g.strokeStyle = 'rgba(80,60,35,0.25)'; for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); for (let x = (y / 32) % 2 ? 24 : 0; x < w; x += 48) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); } } }
    else if (kind === 'paving_new') { g.fillStyle = '#d8d0c2'; g.fillRect(0, 0, w, h); grain(g, w, h, 1500, 0.08, r); g.strokeStyle = 'rgba(90,80,70,0.2)'; for (let i = 0; i <= w; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } }
    else if (kind === 'sidewalk') { g.fillStyle = '#9c968c'; g.fillRect(0, 0, w, h); grain(g, w, h, 1500, 0.1, r); g.strokeStyle = 'rgba(40,40,40,0.25)'; for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } }
  });
}

/* Shared clock face texture: hands follow the time-of-day slider. */
const clockCanvas = document.createElement('canvas'); clockCanvas.width = clockCanvas.height = 256;
const clockTex = new THREE.CanvasTexture(clockCanvas); clockTex.colorSpace = THREE.SRGBColorSpace;
let clockDrawn = -1;
function drawClock(hour) {
  const key = Math.round(hour * 60); if (key === clockDrawn) return; clockDrawn = key;
  const g = clockCanvas.getContext('2d'), c = 128;
  g.fillStyle = '#5c4a33'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#f3ead6'; g.beginPath(); g.arc(c, c, 112, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2b2219'; g.lineWidth = 6; g.stroke();
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.lineWidth = i % 3 ? 4 : 8; g.beginPath(); g.moveTo(c + Math.sin(a) * 92, c - Math.cos(a) * 92); g.lineTo(c + Math.sin(a) * 104, c - Math.cos(a) * 104); g.stroke(); }
  const hand = (a, len, wd) => { g.lineWidth = wd; g.lineCap = 'round'; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.sin(a) * len, c - Math.cos(a) * len); g.stroke(); };
  const m = (hour % 1) * Math.PI * 2, hh = ((hour % 12) / 12) * Math.PI * 2;
  hand(hh, 58, 9); hand(m, 86, 5);
  g.fillStyle = '#2b2219'; g.beginPath(); g.arc(c, c, 8, 0, Math.PI * 2); g.fill();
  clockTex.needsUpdate = true;
}

/* ---------------------------------------------------------------- shared geometry/material caches */
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 14, 10),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  wheel: new THREE.CylinderGeometry(1, 1, 0.22, 14).rotateZ(Math.PI / 2),
  torso: new THREE.CapsuleGeometry(0.19, 0.46, 4, 10),
  head: new THREE.SphereGeometry(0.12, 12, 10),
  leg: new THREE.BoxGeometry(0.13, 0.82, 0.15).translate(0, -0.41, 0),
  arm: new THREE.BoxGeometry(0.09, 0.62, 0.1).translate(0, -0.31, 0),
  dress: new THREE.ConeGeometry(0.34, 0.9, 10, 1, true).translate(0, -0.45, 0),
  dome: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  pyramid: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4),
  frond: new THREE.ConeGeometry(0.42, 3.2, 3).translate(0, 1.6, 0),
  pod: new THREE.CapsuleGeometry(0.85, 2.4, 6, 14).rotateX(Math.PI / 2),
};
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
  return matCache.get(key);
}
function mesh(geo, material, sx = 1, sy = 1, sz = 1) { const m = new THREE.Mesh(geo, material); m.scale.set(sx, sy, sz); m.castShadow = true; return m; }

/* Bake a static group into one mesh per material: street props cost a handful of draw calls. */
function mergeByMaterial(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  group.traverse((o) => { if (o.isMesh && !Array.isArray(o.material)) { if (!buckets.has(o.material)) buckets.set(o.material, []); buckets.get(o.material).push(o); } });
  const out = new THREE.Group();
  for (const [material, list] of buckets) {
    const parts = list.map((o) => { const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(o.matrixWorld); return g; });
    const merged = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const size = parts[0].attributes[name].itemSize;
      const arr = new Float32Array(parts.reduce((n, g) => n + g.attributes[name].count * size, 0));
      let off = 0; for (const g of parts) { arr.set(g.attributes[name].array, off); off += g.attributes[name].array.length; }
      merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    const m = new THREE.Mesh(merged, material); m.castShadow = list[0].castShadow; m.receiveShadow = true; out.add(m);
  }
  return out;
}

/* ---------------------------------------------------------------- path following */
class Path {
  constructor(points) {
    this.pts = points.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.cum = [0];
    for (let i = 0; i < this.pts.length; i++) { const a = this.pts[i], b = this.pts[(i + 1) % this.pts.length]; this.cum.push(this.cum[i] + a.distanceTo(b)); }
    this.length = this.cum[this.cum.length - 1];
  }
  sample(s, out, dir) {
    s = ((s % this.length) + this.length) % this.length;
    let i = 0; while (this.cum[i + 1] < s) i++;
    const a = this.pts[i], b = this.pts[(i + 1) % this.pts.length];
    const t = (s - this.cum[i]) / (this.cum[i + 1] - this.cum[i] || 1);
    out.lerpVectors(a, b, t); if (dir) dir.subVectors(b, a).normalize();
    return out;
  }
}

/* ---------------------------------------------------------------- entity builders */
const ERA_CAR_COLORS = {
  mandate: ['#1d1d1f', '#2e3b2c', '#4a1f1d', '#2a2f3a'],
  modernist: ['#d9822b', '#6a994e', '#e8d44d', '#3e7cb1', '#bc4749', '#f2e8cf'],
  present: ['#e9eaec', '#b7bcc2', '#1b1c1f', '#3a5b85', '#7d2a2a', '#c8c8c8'],
  future: ['#f4f7f7', '#dfe9ec'],
};
function makePedestrian(r, env) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = pick(r, ['#c99a72', '#a8774f', '#e0b48c', '#7d5536', '#f1c8a1']);
  const top = pick(r, env.palette), bottom = pick(r, env.palette);
  const torso = mesh(GEO.torso, mat(top)); torso.position.y = 1.18; body.add(torso);
  const head = mesh(GEO.head, mat(skin)); head.position.y = 1.62; body.add(head);
  const legs = [], arms = [];
  const longRobe = (env.hats === 'fez' && r() < 0.45) || r() < 0.12;
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0.09 * side, 0.86, 0); body.add(hip);
    hip.add(mesh(GEO.leg, mat(longRobe ? top : bottom))); legs.push(hip);
    const sh = new THREE.Group(); sh.position.set(0.25 * side, 1.44, 0); body.add(sh);
    sh.add(mesh(GEO.arm, mat(top))); arms.push(sh);
  }
  if (longRobe) { const d = mesh(GEO.dress, mat(top)); d.position.y = 0.98; body.add(d); }
  if (env.hats === 'fez' && r() < 0.7) { const h = mesh(GEO.cyl, mat('#9e1b1b'), 0.085, 0.14, 0.085); h.position.y = 1.76; body.add(h); }
  if (env.hats === 'fedora' && r() < 0.55) { const b = mesh(GEO.cyl, mat('#2a2622'), 0.2, 0.02, 0.2); b.position.y = 1.72; const c = mesh(GEO.cyl, mat('#2a2622'), 0.11, 0.12, 0.11); c.position.y = 1.78; body.add(b, c); }
  if (env.hats === 'visor' && r() < 0.5) { const v = mesh(GEO.box, mat('#7ff5e1', { emissive: '#4ff5e6', emissiveIntensity: 0.8 }), 0.22, 0.04, 0.05); v.position.set(0, 1.64, 0.11); body.add(v); }
  const s = 0.9 + r() * 0.17; root.scale.setScalar(s);
  return { root, body, legs, arms, height: 1.75 * s };
}
function lights(group, z, y, w, color, intensityRef) {
  for (const side of [-1, 1]) { const l = mesh(GEO.sphere, intensityRef, 0.09, 0.07, 0.04); l.position.set(side * w, y, z); l.castShadow = false; group.add(l); }
}
function makeVehicle(type, r, eraKey, nightMats) {
  const g = new THREE.Group(); const wheels = []; let length = 4.4; let legs = null;
  const palette = ERA_CAR_COLORS[eraKey] || ERA_CAR_COLORS.present;
  const color = pick(r, palette);
  const addWheel = (x, y, z, rad, m = mat('#1c1b1a')) => { const w = mesh(GEO.wheel, m, rad, rad, rad); w.position.set(x, y, z); g.add(w); wheels.push({ m: w, r: rad }); };
  if (type === 'carriage') {
    length = 5.6;
    const wood = mat(pick(r, ['#3b2618', '#2b1d14', '#4a2f1c']));
    const cab = mesh(GEO.box, wood, 1.4, 1.1, 1.8); cab.position.set(0, 1.35, -1.1); g.add(cab);
    const roof = mesh(GEO.box, mat('#1e1712'), 1.55, 0.08, 2.0); roof.position.set(0, 1.94, -1.1); g.add(roof);
    for (const z of [-1.7, -0.5]) for (const x of [-0.78, 0.78]) addWheel(x, 0.55, z, 0.55, mat('#5a3d22'));
    const horse = new THREE.Group(); horse.position.set(0, 0, 1.4); g.add(horse);
    const hc = mat(pick(r, ['#5b3a22', '#2d1f16', '#8a6a4a', '#e6dccb']));
    const torso = mesh(GEO.box, hc, 0.5, 0.6, 1.5); torso.position.y = 1.3; horse.add(torso);
    const neck = mesh(GEO.box, hc, 0.28, 0.75, 0.32); neck.position.set(0, 1.75, 0.75); neck.rotation.x = 0.55; horse.add(neck);
    const head = mesh(GEO.box, hc, 0.24, 0.26, 0.55); head.position.set(0, 2.05, 1.05); horse.add(head);
    legs = [];
    for (const [x, z] of [[-0.17, 0.6], [0.17, 0.6], [-0.17, -0.6], [0.17, -0.6]]) { const p = new THREE.Group(); p.position.set(x, 1.05, z); p.add(mesh(GEO.leg, hc, 0.9, 1.28, 0.9)); horse.add(p); legs.push(p); }
  } else if (type === 'vintage_car') {
    length = 3.8;
    const c = mat(color, { roughness: 0.45, metalness: 0.3 });
    const body = mesh(GEO.box, c, 1.6, 0.55, 3.6); body.position.y = 0.72; g.add(body);
    const cab = mesh(GEO.box, c, 1.4, 0.75, 1.5); cab.position.set(0, 1.35, -0.45); g.add(cab);
    const glass = mesh(GEO.box, mat('#1a2026', { roughness: 0.2 }), 1.42, 0.45, 1.3); glass.position.set(0, 1.42, -0.45); g.add(glass);
    for (const z of [-1.2, 1.2]) for (const x of [-0.82, 0.82]) addWheel(x, 0.4, z, 0.4);
    lights(g, 1.82, 0.9, 0.55, nightMats.head);
  } else if (type === 'car') {
    const modern = eraKey === 'present'; length = modern ? 4.6 : 4.2;
    const c = mat(color, { roughness: modern ? 0.3 : 0.5, metalness: modern ? 0.5 : 0.25 });
    const body = mesh(GEO.box, c, modern ? 1.85 : 1.7, 0.65, length); body.position.y = 0.6; g.add(body);
    const cab = mesh(GEO.box, mat('#20262c', { roughness: 0.15, metalness: 0.3 }), modern ? 1.66 : 1.5, 0.55, modern ? 2.5 : 2.1); cab.position.set(0, 1.18, -0.2); g.add(cab);
    const ry = 0.4; for (const z of [-length * 0.32, length * 0.32]) for (const x of [-0.85, 0.85]) addWheel(x * (modern ? 1.05 : 1), ry * (modern ? 0.9 : 0.85), z, ry);
    lights(g, length / 2 + 0.01, 0.72, 0.6, nightMats.head); lights(g, -length / 2 - 0.01, 0.72, 0.62, nightMats.tail);
  } else if (type === 'bus') {
    length = 11;
    const c = mat(eraKey === 'modernist' ? pick(r, ['#5c8a4e', '#d8cfb4']) : pick(r, ['#e9eef0', '#2f8f8a']));
    const body = mesh(GEO.box, c, 2.5, 2.6, 11); body.position.y = 1.65; g.add(body);
    const win = mesh(GEO.box, mat('#1c2329', { roughness: 0.2 }), 2.52, 0.9, 10.2); win.position.y = 2.15; g.add(win);
    for (const z of [-3.8, 3.6]) for (const x of [-1.15, 1.15]) addWheel(x, 0.5, z, 0.5);
    lights(g, 5.51, 0.9, 0.95, nightMats.head); lights(g, -5.51, 0.9, 0.95, nightMats.tail);
  } else if (type === 'pod') {
    length = 4.1;
    const shell = mesh(GEO.pod, mat(color, { roughness: 0.15, metalness: 0.2 })); shell.scale.set(1, 0.8, 1); shell.position.y = 1.05; g.add(shell);
    const canopy = mesh(GEO.sphere, mat('#14262c', { roughness: 0.05, metalness: 0.6 }), 0.8, 0.55, 1.3); canopy.position.set(0, 1.5, 0.3); g.add(canopy);
    const glow = mesh(GEO.box, nightMats.glow, 1.4, 0.04, 3.2); glow.position.y = 0.32; glow.castShadow = false; g.add(glow);
  }
  return { root: g, wheels, legs, length };
}

/* ---------------------------------------------------------------- world: one era's complete scene */
class World {
  constructor(data, era, opts) {
    this.era = era; this.key = era.key; this.data = data;
    const env = era.environment;
    this.scene = new THREE.Scene();
    this.layers = { buildings: new THREE.Group(), people: new THREE.Group(), vehicles: new THREE.Group(), atmosphere: new THREE.Group() };
    for (const k in this.layers) this.scene.add(this.layers[k]);
    this.windowMats = []; this.lampMats = []; this.lods = []; this.obstacles = []; this.landmarks = [];
    this.night = {
      head: new THREE.MeshStandardMaterial({ color: '#fff6dc', emissive: '#fff1c4', emissiveIntensity: 0.2 }),
      tail: new THREE.MeshStandardMaterial({ color: '#6b0d0d', emissive: '#ff2a1a', emissiveIntensity: 0.2 }),
      glow: new THREE.MeshStandardMaterial({ color: '#7ff5e1', emissive: '#4ff5e6', emissiveIntensity: 1.6 }),
    };
    this.buildSky(); this.buildGround(env); this.buildBuildings(era); this.buildLandmarks(); this.buildStreet(env);
    this.buildAgents(era, env); this.buildWeather();
    this.setShadows(opts.shadows);
  }

  buildSky() {
    this.sun = new THREE.DirectionalLight('#ffffff', 2.5);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -90; sc.right = sc.top = 90; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight('#bcd8ee', '#6b5a44', 0.6); this.scene.add(this.hemi);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, sunColor: { value: new THREE.Color() }, sunVis: { value: 1 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunVis; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, -0.2, 1.0); vec3 c = mix(horizon, top, pow(max(h,0.0), 0.55));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          c += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35) * sunVis;
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(480, 32, 16), this.skyMat); this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    const r = mulberry(4), n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const th = r() * Math.PI * 2, ph = Math.acos(r() * 0.95); pos.set([Math.sin(ph) * Math.cos(th) * 450, Math.cos(ph) * 450, Math.sin(ph) * Math.sin(th) * 450], i * 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#fff8e8', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.scene.add(this.stars);
    this.scene.fog = new THREE.Fog('#bcd8ee', 60, 420);
  }

  buildGround(env) {
    const road = env.road;
    const base = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), mat(road === 'dirt' ? '#b39b74' : road === 'smart' ? '#2c3438' : '#5f5c57', { roughness: 1 }));
    base.receiveShadow = true; this.scene.add(base);
    const plane = (w, d, y, tex, rep, extra = {}) => {
      tex.repeat.set(w / rep, d / rep);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, ...extra }));
      m.position.y = y; m.receiveShadow = true; this.scene.add(m); return m;
    };
    plane(92, 72, 0.03, groundTex(road === 'dirt' ? 'dirt' : 'sidewalk'), 6);
    plane(80, 60, 0.06, groundTex(road), road === 'cobble' ? 3 : 10, road === 'smart' ? { emissive: '#0b2b2a', emissiveIntensity: 0.6 } : {});
    plane(64, 44, 0.09, groundTex(road === 'dirt' ? 'dirt' : (this.key === 'mandate' || this.key === 'modernist') ? 'paving_old' : 'paving_new'), 6);
    if (road === 'asphalt' || road === 'smart') {
      const dash = road === 'smart' ? this.lampLike('#4ff5e6') : mat('#e8e4d8', { roughness: 0.7 });
      const path = new Path([[-36, -26], [36, -26], [36, 26], [-36, 26]]);
      const v = new THREE.Vector3(), d = new THREE.Vector3(), dashes = new THREE.Group();
      for (let s = 0; s < path.length; s += 4) {
        path.sample(s, v, d);
        const m = new THREE.Mesh(GEO.box, dash); m.scale.set(0.15, 0.01, 2); m.position.set(v.x, 0.075, v.z); m.rotation.y = Math.atan2(d.x, d.z); dashes.add(m);
      }
      this.scene.add(mergeByMaterial(dashes));
    }
  }

  lampLike(color) { const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 }); this.lampMats.push(m); return m; }

  styleMaterials(style, variant) {
    const key = style + variant; this._mats = this._mats || new Map();
    if (this._mats.has(key)) return this._mats.get(key);
    const st = STYLES[style]; const tex = facadeTextures(style, variant);
    const side = new THREE.MeshStandardMaterial({ map: tex.map, emissiveMap: tex.emissive, emissive: '#ffffff', emissiveIntensity: 0, roughness: st.rough, metalness: st.metal });
    const far = new THREE.MeshLambertMaterial({ map: tex.map, emissiveMap: tex.emissive, emissive: '#ffffff', emissiveIntensity: 0 });
    const roof = mat(st.roof, { roughness: 0.95 });
    this.windowMats.push(side, far);
    const out = { full: [side, roof], far: [far, roof] };
    this._mats.set(key, out); return out;
  }

  boxWithUV(w, h, d, st) {
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
    const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      const su = faces[f][0] / (st.bayW * 4), sv = faces[f][1] / (st.floorH * 4);
      for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv); }
    }
    // Regroup faces so the four walls draw in one call and the roof in another.
    const idx = g.index.array, face = (f) => Array.from(idx.slice(f * 6, f * 6 + 6));
    g.setIndex([0, 1, 4, 5, 2, 3].flatMap(face));
    g.clearGroups(); g.addGroup(0, 24, 0); g.addGroup(24, 12, 1);
    return g;
  }

  makeBuilding(style, w, d, floors, r) {
    const st = STYLES[style]; const h = floors * st.floorH;
    const mats = this.styleMaterials(style, Math.floor(r() * 3));
    const geo = this.boxWithUV(w, h, d, st);
    const lod = new THREE.LOD();
    const hi = new THREE.Group(), mid = new THREE.Mesh(geo, mats.full), lo = new THREE.Mesh(geo, mats.far);
    const body = new THREE.Mesh(geo, mats.full); body.position.y = h / 2; mid.position.y = h / 2; lo.position.y = h / 2;
    for (const m of [body, mid, lo]) { m.castShadow = true; m.receiveShadow = true; }
    hi.add(body);
    const year = this.era.year;
    if (style === 'ottoman') {
      if (r() < 0.3) { const dm = mesh(GEO.dome, mat('#cdb995'), Math.min(w, d) * 0.22, Math.min(w, d) * 0.2, Math.min(w, d) * 0.22); dm.position.y = h; hi.add(dm); }
      if (r() < 0.5 && floors > 1) { const b = mesh(GEO.box, mat('#4a3324'), Math.min(4, w * 0.4), 1.8, 0.8); b.position.set(0, st.floorH * 1.5, d / 2 + 0.4); hi.add(b); }
      const par = mesh(GEO.box, mat(st.roof), w + 0.2, 0.6, d + 0.2); par.position.y = h + 0.3; par.scale.y = 0.6; hi.add(par);
    } else if (style === 'mandate') {
      if (r() < 0.45) { const p = mesh(GEO.pyramid, mat(st.roof), w * 1.02, Math.min(w, d) * 0.35, d * 1.02); p.position.y = h + Math.min(w, d) * 0.175; hi.add(p); }
      for (let f = 1; f < floors; f++) { const b = mesh(GEO.box, mat('#e9e2d2'), w * 0.7, 0.15, 1.1); b.position.set(0, f * st.floorH, d / 2 + 0.55); hi.add(b); const rl = mesh(GEO.box, mat('#3c3a36'), w * 0.7, 0.9, 0.04); rl.position.set(0, f * st.floorH + 0.5, d / 2 + 1.08); hi.add(rl); }
    } else if (style === 'future') {
      const strip = mesh(GEO.box, this.lampLike('#4ff5e6'), 0.25, h * 0.9, 0.25); strip.position.set(w / 2, h * 0.5, d / 2); hi.add(strip);
      if (floors > 10) { const ant = mesh(GEO.cyl, mat('#cfd8dc'), 0.15, 8, 0.15); ant.position.y = h + 4; hi.add(ant); }
    }
    if (year >= 1960 && (style === 'brutalist' || style === 'mandate') && floors < 10 && r() < 0.8) {
      // Rooftop solar water heaters, a fixture of Israeli roofs since the 1960s.
      for (let i = 0; i < 1 + Math.floor(r() * 3); i++) {
        const x = (r() - 0.5) * (w - 3), z = (r() - 0.5) * (d - 3);
        const tank = mesh(GEO.cyl, mat('#d6d3cc'), 0.35, 1.6, 0.35); tank.rotation.z = Math.PI / 2; tank.position.set(x, h + 1.3, z - 0.6); hi.add(tank);
        const panel = mesh(GEO.box, mat('#1f2c3d', { roughness: 0.3, metalness: 0.4 }), 1.8, 0.06, 1.4); panel.rotation.x = -0.6; panel.position.set(x, h + 0.7, z + 0.4); hi.add(panel);
      }
    }
    const rad = Math.hypot(w, d) / 2;
    lod.addLevel(hi, 0); lod.addLevel(mid, 10 + rad); lod.addLevel(lo, 50 + rad);
    this.lods.push(lod);
    return lod;
  }

  buildBuildings(era) {
    const blocks = this.data.blocks;
    for (const spec of era.buildings) {
      const r = mulberry(spec.seed);
      if (spec.block === 'skyline') { this.buildSkyline(spec, blocks.skyline, r); continue; }
      const b = blocks[spec.block];
      const along = (b.face === 'north' || b.face === 'south') ? b.w : b.d;
      const depth = (b.face === 'north' || b.face === 'south') ? b.d : b.w;
      const rot = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 }[b.face];
      const grp = new THREE.Group(); grp.position.set(b.x, 0, b.z); grp.rotation.y = rot;
      let u = -along / 2;
      while (u < along / 2 - 4) {
        const lw = Math.min(8 + r() * 8, along / 2 - u);
        const style = weighted(r, spec.mix);
        const floors = spec.floors[0] + Math.floor(r() * (spec.floors[1] - spec.floors[0] + 1));
        const dd = depth * (0.55 + r() * 0.45), setback = r() * 1.2;
        const bld = this.makeBuilding(style, lw - 0.3, dd, floors, r);
        bld.position.set(u + lw / 2, 0, depth / 2 - dd / 2 - setback);
        grp.add(bld); u += lw;
      }
      this.layers.buildings.add(grp);
      this.obstacles.push({ type: 'box', minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 });
    }
  }

  buildSkyline(spec, ring, r) {
    const cell = 30;
    for (let gx = -ring.ring_outer; gx <= ring.ring_outer; gx += cell) for (let gz = -ring.ring_outer; gz <= ring.ring_outer; gz += cell) {
      const cheb = Math.max(Math.abs(gx), Math.abs(gz));
      if (cheb < ring.ring_inner || r() > spec.density) continue;
      const style = weighted(r, spec.mix);
      const floors = spec.floors[0] + Math.floor(r() * (spec.floors[1] - spec.floors[0] + 1));
      const w = 14 + r() * 12, d = 14 + r() * 12;
      const bld = this.makeBuilding(style, w, d, floors, r);
      bld.position.set(gx + (r() - 0.5) * 8, 0, gz + (r() - 0.5) * 8); bld.rotation.y = Math.atan2(gx, gz);
      this.layers.buildings.add(bld);
    }
  }

  buildLandmarks() {
    for (const lm of this.data.landmarks || []) {
      if (lm.kind !== 'clock_tower') continue;
      const g = new THREE.Group(); g.position.set(lm.x, 0, lm.z);
      const stone = mat('#d3bb92', { roughness: 0.95 }), trim = mat('#bda27a');
      const base = mesh(GEO.box, stone, 4.2, 1.2, 4.2); base.position.y = 0.6;
      const shaft = mesh(GEO.box, stone, 3.4, 11, 3.4); shaft.position.y = 6.7;
      const band = mesh(GEO.box, trim, 3.8, 0.4, 3.8); band.position.y = 12.3;
      const clock = mesh(GEO.box, stone, 3.6, 3.4, 3.6); clock.position.y = 14.2;
      const cap = mesh(GEO.box, trim, 4.0, 0.4, 4.0); cap.position.y = 16.1;
      const cup = mesh(GEO.dome, stone, 1.5, 1.6, 1.5); cup.position.y = 16.3;
      const spire = mesh(GEO.cyl, mat('#6e5a3e'), 0.06, 2.2, 0.06); spire.position.y = 18.6;
      g.add(base, shaft, band, clock, cap, cup, spire);
      const faceMat = new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.6, emissive: '#fff0c8', emissiveMap: clockTex, emissiveIntensity: 0 });
      this.windowMats.push(faceMat);
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), faceMat); const a = i * Math.PI / 2;
        f.position.set(Math.sin(a) * 1.82, 14.2, Math.cos(a) * 1.82); f.rotation.y = a; g.add(f);
      }
      g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
      g.userData = lm; this.landmarks.push(g); this.layers.buildings.add(g);
      this.obstacles.push({ type: 'circle', x: lm.x, z: lm.z, r: 2.6, landmark: g });
    }
  }

  buildStreet(env) {
    const lampColor = { oil: '#ffae4d', gas: '#ffd38a', sodium: '#ffa23a', led: '#f2f5ff', neon: '#4ff5e6' }[env.lamps] || '#ffd38a';
    const head = this.lampLike(lampColor);
    const post = mat(env.lamps === 'neon' ? '#cfd8dc' : env.lamps === 'led' ? '#3b3f44' : '#2a2622', { roughness: 0.6, metalness: 0.4 });
    const tall = env.lamps === 'sodium' || env.lamps === 'led' ? 6.5 : env.lamps === 'neon' ? 5 : 3.4;
    const spots = [];
    for (let x = -30; x <= 30; x += 15) spots.push([x, -21.5], [x, 21.5]);
    for (let z = -7; z <= 7; z += 14) spots.push([-31.5, z], [31.5, z]);
    const step = env.lamps === 'oil' ? 2 : 1;
    spots.forEach(([x, z], i) => {
      if (i % step) return;
      const p = mesh(GEO.cyl, post, 0.07, tall, 0.07); p.position.set(x, tall / 2, z);
      const h = mesh(GEO.sphere, head, env.lamps === 'neon' ? 0.35 : 0.22, env.lamps === 'neon' ? 0.08 : 0.28, env.lamps === 'neon' ? 0.35 : 0.22); h.position.set(x, tall + 0.1, z); h.castShadow = false;
      this.layers.atmosphere.add(p, h); this.obstacles.push({ type: 'circle', x, z, r: 0.4 });
    });
    this.lampLights = [];
    for (const [x, z] of [[-22, -18], [22, -18], [-22, 18], [22, 18]]) {
      const l = new THREE.PointLight(lampColor, 0, 38, 2); l.position.set(x, tall, z); this.scene.add(l); this.lampLights.push(l);
    }
    // Palms ring the plaza.
    const r = mulberry(77), trunk = mat('#7a6146'), frond = mat('#4f6b33', { side: THREE.DoubleSide });
    for (let i = 0; i < env.palms; i++) {
      const t = i / env.palms * Math.PI * 2;
      const x = Math.cos(t) * 28 + (r() - 0.5) * 2, z = Math.sin(t) * 18.5 + (r() - 0.5) * 2;
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const hgt = 6 + r() * 3; const tr = mesh(GEO.cyl, trunk, 0.2, hgt, 0.2); tr.position.y = hgt / 2; tr.rotation.z = (r() - 0.5) * 0.12; g.add(tr);
      for (let k = 0; k < 8; k++) { const f = mesh(GEO.frond, frond, 1, 1, 0.25); f.position.y = hgt; f.rotation.set(0, k / 8 * Math.PI * 2 + r(), 1.15 + r() * 0.5, 'YXZ'); g.add(f); }
      this.layers.atmosphere.add(g); this.obstacles.push({ type: 'circle', x, z, r: 0.6 });
    }
    const merged = mergeByMaterial(this.layers.atmosphere);
    this.layers.atmosphere.clear(); this.layers.atmosphere.add(merged);
  }

  buildAgents(era, env) {
    this.peds = []; this.vehicles = []; this.lanes = new Map();
    const paths = this.data.paths || {};
    const r = mulberry(era.year * 7 + 3);
    for (const ent of era.entities) {
      const pts = typeof ent.path === 'string' ? paths[ent.path] : ent.path;
      if (!pts || pts.length < 2) continue;
      const path = new Path(pts);
      const count = Math.max(1, Math.round(path.length / (ent.speed_mps * ent.spawn_interval_sec)));
      if (ent.entity_type === 'pedestrian') {
        for (let i = 0; i < count; i++) {
          const rev = r() < 0.5;
          const p = rev ? new Path([...pts].reverse()) : path;
          const ped = makePedestrian(r, env);
          const s0 = (i + r() * 0.6) / count * p.length;
          const pos = p.sample(s0, new THREE.Vector3());
          let idx = 0; while (p.cum[idx + 1] < s0) idx++;
          const agent = { ...ped, path: p, wp: (idx + 1) % p.pts.length, pos, vel: new THREE.Vector3(), speed: ent.speed_mps * (0.85 + r() * 0.3), offset: (r() - 0.5) * 2.2, phase: r() * 10, yaw: 0 };
          ped.root.position.copy(pos); this.layers.people.add(ped.root); this.peds.push(agent);
        }
      } else {
        const lane = this.lanes.get(ent.path) || []; this.lanes.set(ent.path, lane);
        for (let i = 0; i < count; i++) {
          const v = makeVehicle(ent.entity_type, r, this.key, this.night);
          const agent = { ...v, type: ent.entity_type, path, s: (i + r() * 0.3) / count * path.length, base: ent.speed_mps, speed: ent.speed_mps, pos: new THREE.Vector3(), dir: new THREE.Vector3(), yaw: null, phase: r() * 10 };
          this.layers.vehicles.add(v.root); this.vehicles.push(agent); lane.push(agent);
        }
      }
    }
  }

  buildWeather() {
    const n = 1600, pos = new Float32Array(n * 6), r = mulberry(9);
    for (let i = 0; i < n; i++) { const x = (r() - 0.5) * 70, y = r() * 30, z = (r() - 0.5) * 70; pos.set([x, y, z, x + 0.05, y - 0.7, z], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#b8c6d4', transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false; this.rain.visible = false; this.scene.add(this.rain);
  }

  setShadows(on) { this.sun.castShadow = on; }

  setYear(year) { for (const lm of this.landmarks) lm.visible = year >= lm.userData.year_start && year <= lm.userData.year_end; }

  setLayers(layers) {
    this.layers.buildings.visible = layers.buildings;
    this.layers.people.visible = layers.people;
    this.layers.vehicles.visible = layers.vehicles;
  }

  applyEnvironment(hour, weather, atmosphere) {
    if (!atmosphere) { hour = 12.5; weather = 'clear'; }
    const t = (hour - 6) / 12; const alt = Math.sin(t * Math.PI);
    const elev = alt * 1.12, az = t * Math.PI;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), 0.45 * Math.cos(elev)).normalize();
    const day = smooth(-0.12, 0.3, alt), night = 1 - smooth(-0.2, 0.06, alt);
    const golden = smooth(-0.15, 0.04, alt) * (1 - smooth(0.06, 0.42, alt));
    const overcast = weather === 'clear' ? 0 : weather === 'fog' ? 0.8 : 0.65;
    const top = new THREE.Color('#0a1024').lerp(new THREE.Color('#3f7fcf'), day);
    const hor = new THREE.Color('#1c2542').lerp(new THREE.Color('#c4dcef'), day).lerp(new THREE.Color('#f29a58'), golden * 0.75);
    const grey = new THREE.Color('#8d949b').multiplyScalar(0.25 + 0.75 * day);
    top.lerp(grey, overcast); hor.lerp(grey, overcast * 0.9);
    const sunCol = new THREE.Color('#fff4e2').lerp(new THREE.Color('#ff9a4d'), golden);
    this.skyMat.uniforms.top.value.copy(top); this.skyMat.uniforms.horizon.value.copy(hor);
    this.skyMat.uniforms.sunDir.value.copy(dir); this.skyMat.uniforms.sunColor.value.copy(sunCol); this.skyMat.uniforms.sunVis.value = (1 - overcast) * smooth(-0.05, 0.05, alt);
    this.sun.position.copy(dir).multiplyScalar(160); this.sun.color.copy(sunCol);
    this.sun.intensity = 2.8 * day * (1 - 0.75 * overcast) + 0.15 * night;
    if (night > 0.5) { this.sun.position.set(-60, 120, 40); this.sun.color.set('#9fb4ff'); }
    this.hemi.color.copy(hor).lerp(new THREE.Color('#ffffff'), 0.3); this.hemi.groundColor.set(this.key === 'ottoman' ? '#6b5a44' : '#4a4642');
    this.hemi.intensity = 0.18 + 0.75 * day;
    this.stars.material.opacity = night * (1 - overcast);
    this.scene.fog.color.copy(hor);
    if (weather === 'fog') { this.scene.fog.near = 4; this.scene.fog.far = 75; }
    else if (weather === 'rain') { this.scene.fog.near = 15; this.scene.fog.far = 180; }
    else { this.scene.fog.near = 60; this.scene.fog.far = 430; }
    for (const m of this.windowMats) m.emissiveIntensity = night * 1.5;
    for (const m of this.lampMats) m.emissiveIntensity = 0.4 + night * 3.5;
    for (const l of this.lampLights) l.intensity = night * 150;
    this.night.head.emissiveIntensity = 0.3 + night * 4; this.night.tail.emissiveIntensity = 0.3 + night * 2.5;
    this.rain.visible = weather === 'rain';
    this.exposure = 1.0 + night * 0.35;
  }

  update(dt, time, user) {
    // Vehicles: lane following with gap keeping, and they stop for the viewer.
    for (const [, lane] of this.lanes) {
      lane.sort((a, b) => a.s - b.s);
      for (let i = 0; i < lane.length; i++) {
        const v = lane[i], ahead = lane[(i + 1) % lane.length], L = v.path.length;
        let gap = lane.length > 1 ? ((ahead.s - v.s + L) % L) - (ahead.length + v.length) / 2 : 999;
        let target = v.base * clamp((gap - 2.5) / 9, 0, 1);
        const probe = v.path.sample(v.s + v.length / 2 + 4, new THREE.Vector3());
        if (Math.hypot(probe.x - user.x, probe.z - user.z) < 3.4) target = 0;
        v.speed = lerp(v.speed, target, 1 - Math.exp(-dt * (target < v.speed ? 4 : 1.2)));
        v.s += v.speed * dt;
        v.path.sample(v.s, v.pos, v.dir);
        const yaw = Math.atan2(v.dir.x, v.dir.z);
        if (v.yaw === null) v.yaw = yaw;
        let dy = yaw - v.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); v.yaw += dy * (1 - Math.exp(-dt * 5));
        v.root.position.set(v.pos.x, v.type === 'pod' ? 0.25 + Math.sin(time * 2 + v.phase) * 0.06 : 0, v.pos.z);
        v.root.rotation.y = v.yaw;
        for (const w of v.wheels) w.m.rotation.x += v.speed * dt / w.r;
        if (v.legs) { const ph = time * v.speed * 2.6 + v.phase; v.legs.forEach((l, k) => { l.rotation.x = Math.sin(ph + (k % 2 ? Math.PI : 0) + (k > 1 ? 0.5 : 0)) * 0.5 * clamp(v.speed, 0, 1); }); }
      }
    }
    // Pedestrians: waypoint seeking + separation + obstacle and viewer avoidance.
    const tmp = new THREE.Vector3(), steer = new THREE.Vector3();
    for (const p of this.peds) {
      const wp = p.path.pts[p.wp], next = p.path.pts[(p.wp + 1) % p.path.pts.length];
      tmp.subVectors(next, wp).normalize();
      const tx = wp.x + -tmp.z * p.offset, tz = wp.z + tmp.x * p.offset;
      steer.set(tx - p.pos.x, 0, tz - p.pos.z);
      if (steer.length() < 1.6) p.wp = (p.wp + 1) % p.path.pts.length;
      steer.normalize().multiplyScalar(p.speed);
      for (const o of this.peds) {
        if (o === p) continue; const dx = p.pos.x - o.pos.x, dz = p.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
        if (d2 < 1.3 && d2 > 1e-4) { const d = Math.sqrt(d2), f = (1.15 - d) * 2.2; steer.x += dx / d * f; steer.z += dz / d * f; }
      }
      const ux = p.pos.x - user.x, uz = p.pos.z - user.z, ud = Math.hypot(ux, uz);
      if (ud < 3.2 && ud > 1e-3) { const f = (3.2 - ud) * 2.4; steer.x += ux / ud * f - uz / ud * f * 0.6; steer.z += uz / ud * f + ux / ud * f * 0.6; }
      for (const ob of this.obstacles) {
        if (ob.type !== 'circle' || (ob.landmark && !ob.landmark.visible)) continue;
        const dx = p.pos.x - ob.x, dz = p.pos.z - ob.z, d = Math.hypot(dx, dz), lim = ob.r + 1.3;
        if (d < lim && d > 1e-3) { const f = (lim - d) * 2.5; steer.x += dx / d * f - dz / d * f * 0.8; steer.z += dz / d * f + dx / d * f * 0.8; }
      }
      if (steer.length() > p.speed * 1.6) steer.setLength(p.speed * 1.6);
      p.vel.lerp(steer, 1 - Math.exp(-dt * 3));
      p.pos.addScaledVector(p.vel, dt);
      const sp = p.vel.length();
      if (sp > 0.05) { const yaw = Math.atan2(p.vel.x, p.vel.z); let dy = yaw - p.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); p.yaw += dy * (1 - Math.exp(-dt * 6)); }
      p.root.position.set(p.pos.x, 0.09, p.pos.z); p.root.rotation.y = p.yaw;
      const near = Math.hypot(p.pos.x - user.x, p.pos.z - user.z) < 50;
      if (near) {
        p.phase += dt * sp * 4.6; const sw = Math.sin(p.phase) * 0.55 * clamp(sp / 1.2, 0, 1);
        p.legs[0].rotation.x = sw; p.legs[1].rotation.x = -sw; p.arms[0].rotation.x = -sw * 0.8; p.arms[1].rotation.x = sw * 0.8;
        p.body.position.y = Math.abs(Math.cos(p.phase)) * 0.04 * clamp(sp, 0, 1);
      }
    }
    this.rain.position.set(user.x, 0, user.z);
    if (this.rain.visible) {
      const a = this.rain.geometry.attributes.position, arr = a.array;
      for (let i = 0; i < arr.length; i += 6) { arr[i + 1] -= 22 * dt; arr[i + 4] -= 22 * dt; if (arr[i + 4] < 0) { arr[i + 1] += 30; arr[i + 4] += 30; } }
      a.needsUpdate = true;
    }
  }

  lodCounts(out) { for (const l of this.lods) out[l.getCurrentLevel()]++; }
}

/* ---------------------------------------------------------------- reconstruction (mode wrapper) */
const compositeShader = {
  uniforms: {
    tTarget: { value: null }, tPrev: { value: null }, tOuter: { value: null }, fade: { value: 1 },
    lensOn: { value: 1 }, center: { value: new THREE.Vector2() }, radius: { value: 200 }, res: { value: new THREE.Vector2(1, 1) },
    expIn: { value: 1 }, expOut: { value: 1 }, time: { value: 0 }, sepia: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tTarget, tPrev, tOuter; uniform float fade, lensOn, radius, expIn, expOut, time, sepia;
    uniform vec2 center, res; varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
    vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
    void main(){
      vec2 px = vUv * res; vec2 dv = px - center; float d = length(dv); vec2 dir = dv / max(d, 1e-3);
      float band = min(34.0, radius * 0.16);
      float rimBand = smoothstep(radius - band, radius, d) * step(d, radius) * lensOn;
      vec2 uvIn = vUv - dir / res * rimBand * rimBand * band * 0.6;
      vec3 inner = mix(texture2D(tPrev, uvIn).rgb, texture2D(tTarget, uvIn).rgb, fade);
      inner = toSRGB(aces(inner * expIn));
      float lum = dot(inner, vec3(0.299, 0.587, 0.114));
      inner = mix(inner, vec3(lum) * vec3(1.07, 0.96, 0.78), sepia);
      vec3 outer = toSRGB(aces(texture2D(tOuter, vUv).rgb * expOut));
      float inside = lensOn > 0.5 ? 1.0 - smoothstep(radius - 1.5, radius + 1.5, d) : 1.0;
      outer *= mix(1.0, 0.78, lensOn);
      vec3 col = mix(outer, inner, inside);
      float ring = lensOn * (smoothstep(radius - 1.0, radius + 1.0, d) - smoothstep(radius + 5.0, radius + 7.5, d));
      float shine = 0.75 + 0.25 * sin(atan(dv.y, dv.x) * 2.0 + time * 0.6);
      col = mix(col, vec3(0.85, 0.64, 0.36) * shine, ring);
      vec2 q = vUv - 0.5; col *= 1.0 - dot(q, q) * 0.35;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Reconstruction {
  constructor(renderer, data, { shadows = true } = {}) {
    this.renderer = renderer; this.data = data; this.shadows = shadows;
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.1, 1200); this.camera.rotation.order = 'YXZ';
    const rtOpts = { type: THREE.HalfFloatType, samples: shadows ? 4 : 2 };
    this.rt = { target: new THREE.WebGLRenderTarget(1, 1, rtOpts), prev: new THREE.WebGLRenderTarget(1, 1, rtOpts), outer: new THREE.WebGLRenderTarget(1, 1, rtOpts) };
    this.composite = new THREE.ShaderMaterial({ ...compositeShader, depthTest: false, depthWrite: false, toneMapped: false });
    this.compScene = new THREE.Scene(); this.compScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composite));
    this.compCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.worlds = new Map(); this.target = null; this.prev = null; this.fadeT = 1; this.lastEraYear = null;
    this.state = { year: 1920, hour: 17.5, weather: 'clear', layers: { buildings: true, people: true, vehicles: true, atmosphere: true } };
    this.lens = { on: true, x: 0, y: 0, r: 150 };
    this.user = { pos: new THREE.Vector3(7, 1.65, 10), yaw: 0, pitch: -0.1, vel: new THREE.Vector3(), bob: 0 };
    this.move = { x: 0, z: 0, run: false }; this.W = 1; this.H = 1; this.dpr = 1;
  }

  eraFor(year) { return this.data.eras.find((e) => year >= e.year_start && year <= e.year_end) || this.data.eras[this.data.eras.length - 1]; }
  presentEra() { return this.eraFor(new Date().getFullYear()); }
  getWorld(era) {
    if (!this.worlds.has(era.year)) {
      const w = new World(this.data, era, { shadows: this.shadows }); w.setLayers(this.state.layers);
      w.applyEnvironment(this.state.hour, this.state.weather, this.state.layers.atmosphere); w.setYear(this.state.year); this.worlds.set(era.year, w);
    }
    return this.worlds.get(era.year);
  }
  /** Build the remaining eras a little at a time so switching never stalls. */
  warmUp() {
    const rest = this.data.eras.filter((e) => !this.worlds.has(e.year));
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
    const step = () => { const e = rest.shift(); if (!e) return; this.getWorld(e); idle(step); };
    idle(step);
  }

  setYear(y) {
    this.state.year = y;
    const era = this.eraFor(y);
    if (era.year !== this.lastEraYear) {
      const w = this.getWorld(era);
      if (this.target && w !== this.target) { this.prev = this.target; this.fadeT = 0; }
      this.target = w; this.lastEraYear = era.year;
    }
    for (const w of this.worlds.values()) w.setYear(y);
    this.composite.uniforms.sepia.value = y < 1900 ? 0.35 : y < 1945 ? 0.18 : 0;
    return era;
  }
  setHour(h) { this.state.hour = h; drawClock(h); this.applyEnv(); }
  setWeather(w) { this.state.weather = w; this.applyEnv(); }
  setLayers(l) { this.state.layers = { ...l }; for (const w of this.worlds.values()) w.setLayers(this.state.layers); this.applyEnv(); }
  applyEnv() { for (const w of this.worlds.values()) w.applyEnvironment(this.state.hour, this.state.weather, this.state.layers.atmosphere); }

  resize(W, H, dpr) {
    this.W = W; this.H = H; this.dpr = dpr;
    this.camera.aspect = W / H; this.camera.fov = W < H ? 74 : 62; this.camera.updateProjectionMatrix();
    const bw = Math.floor(W * dpr), bh = Math.floor(H * dpr);
    for (const k in this.rt) this.rt[k].setSize(bw, bh);
    this.composite.uniforms.res.value.set(bw, bh);
  }

  look(dx, dy) { const k = 0.0042 * (60 / this.camera.fov); this.user.yaw += dx * k; this.user.pitch = clamp(this.user.pitch + dy * k, -1.2, 1.2); }

  collide(p) {
    for (const ob of (this.target ? this.target.obstacles : [])) {
      if (ob.type === 'box') {
        if (p.x > ob.minX - 0.4 && p.x < ob.maxX + 0.4 && p.z > ob.minZ - 0.4 && p.z < ob.maxZ + 0.4) {
          const dl = p.x - (ob.minX - 0.4), dr = ob.maxX + 0.4 - p.x, dt = p.z - (ob.minZ - 0.4), db = ob.maxZ + 0.4 - p.z, m = Math.min(dl, dr, dt, db);
          if (m === dl) p.x = ob.minX - 0.4; else if (m === dr) p.x = ob.maxX + 0.4; else if (m === dt) p.z = ob.minZ - 0.4; else p.z = ob.maxZ + 0.4;
        }
      } else if (!ob.landmark || ob.landmark.visible) {
        const dx = p.x - ob.x, dz = p.z - ob.z, d = Math.hypot(dx, dz), lim = ob.r + 0.35;
        if (d < lim && d > 1e-4) { p.x = ob.x + dx / d * lim; p.z = ob.z + dz / d * lim; }
      }
    }
    p.x = clamp(p.x, -150, 150); p.z = clamp(p.z, -150, 150);
  }

  updateCamera(dt, reducedMotion) {
    const { user, camera } = this;
    camera.rotation.set(-user.pitch, -user.yaw, 0, 'YXZ');
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const want = new THREE.Vector3().addScaledVector(fwd, this.move.z).addScaledVector(right, this.move.x);
    if (want.lengthSq() > 1) want.normalize();
    user.vel.lerp(want.multiplyScalar(this.move.run ? 4.2 : 1.6), 1 - Math.exp(-dt * 8));
    user.pos.addScaledVector(user.vel, dt); this.collide(user.pos);
    const sp = user.vel.length(); user.bob += dt * sp * 5.5;
    user.pos.y = 1.65 + (reducedMotion ? 0 : Math.sin(user.bob) * 0.025 * clamp(sp, 0, 1));
    camera.position.copy(user.pos);
  }

  render(dt, time, reducedMotion) {
    if (!this.target) return;
    this.updateCamera(dt, reducedMotion);
    const r = this.renderer, ux = this.user.pos.x, uz = this.user.pos.z;
    const present = this.getWorld(this.presentEra());
    const showOuter = this.lens.on && present !== this.target;
    const active = new Set([this.target]); if (this.fadeT < 1 && this.prev) active.add(this.prev); if (showOuter) active.add(present);
    for (const w of active) w.update(dt, time, { x: ux, z: uz });
    r.shadowMap.enabled = this.shadows;
    r.setRenderTarget(this.rt.target); r.render(this.target.scene, this.camera);
    if (this.fadeT < 1 && this.prev) { r.setRenderTarget(this.rt.prev); r.render(this.prev.scene, this.camera); this.fadeT = Math.min(1, this.fadeT + dt / 0.7); } else { this.fadeT = 1; this.prev = null; }
    if (showOuter) { r.setRenderTarget(this.rt.outer); r.render(present.scene, this.camera); }
    const u = this.composite.uniforms, f = this.fadeT;
    u.tTarget.value = this.rt.target.texture; u.tPrev.value = (this.prev ? this.rt.prev : this.rt.target).texture;
    u.fade.value = f * f * (3 - 2 * f); u.lensOn.value = this.lens.on ? 1 : 0;
    u.tOuter.value = (showOuter ? this.rt.outer : this.rt.target).texture;
    u.center.value.set(this.lens.x * this.dpr, (this.H - this.lens.y) * this.dpr); u.radius.value = this.lens.r * this.dpr;
    u.expIn.value = this.target.exposure || 1; u.expOut.value = present.exposure || 1; u.time.value = time;
    r.setRenderTarget(null); r.render(this.compScene, this.compCam);
  }

  stats() {
    const lod = [0, 0, 0]; this.target.lodCounts(lod);
    return { lod, peds: this.target.peds.length, vehicles: this.target.vehicles.length, pos: this.user.pos, geo: localToGeo(this.data.location, this.user.pos.x, this.user.pos.z) };
  }
}
