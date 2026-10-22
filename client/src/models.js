// Procedural period models that stand in for what the camera sees: animals and carriages for
// vehicles, stone blocks and benches for seats, lamps for traffic lights. Units are metres.
// Every model faces +x (side view) and stands on y = 0; `seat` is the height a rider sits at.
import * as THREE from 'three';

const cache = new Map();
const mat = (color, opts = {}) => {
  const key = color + JSON.stringify(opts);
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts }));
  return cache.get(key);
};
function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
const noise = (g, s, n, a) => { for (let i = 0; i < n; i++) { const v = Math.random() > 0.5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${a * Math.random()})`; g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 3); } };
const TEX = {};
const tex = (name) => TEX[name] || (TEX[name] = ({
  wood: () => canvasTex(128, (g, s) => { g.fillStyle = '#7a5434'; g.fillRect(0, 0, s, s); for (let y = 0; y < s; y += 3) { g.fillStyle = `rgba(40,22,10,${0.08 + Math.random() * 0.18})`; g.fillRect(0, y + Math.sin(y) * 1.5, s, 1.5); } noise(g, s, 500, 0.1); }),
  stone: () => canvasTex(128, (g, s) => { g.fillStyle = '#cdbb98'; g.fillRect(0, 0, s, s); noise(g, s, 2500, 0.22); for (let i = 0; i < 25; i++) { g.fillStyle = `rgba(90,70,40,${Math.random() * 0.2})`; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 5, 0, 6.3); g.fill(); } }),
  concrete: () => canvasTex(128, (g, s) => { g.fillStyle = '#a8a59d'; g.fillRect(0, 0, s, s); noise(g, s, 3000, 0.15); }),
  blanket: () => canvasTex(64, (g, s) => { const cols = ['#8e2a22', '#d9b25a', '#1f3b5c', '#8e2a22', '#e8dcc0']; for (let i = 0; i < 8; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(0, i * 8, s, 8); } }),
  fur: () => canvasTex(64, (g, s) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * s, Math.random() * s, 1, 3 + Math.random() * 3); } }),
})[name]());

const furMat = (color) => {
  const key = 'fur' + color;
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, map: tex('fur'), roughness: 0.95 }));
  return cache.get(key);
};
const texMat = (name, color = '#ffffff', opts = {}) => {
  const key = 'tex' + name + color;
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, map: tex(name), roughness: 0.9, ...opts }));
  return cache.get(key);
};

function add(group, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; group.add(m); return m;
}
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 12);
const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

function profile(points, depth, material, bevel = 0.04) {
  const shape = new THREE.Shape(); shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.length === 4) shape.quadraticCurveTo(p[0], p[1], p[2], p[3]); else shape.lineTo(p[0], p[1]);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 10 });
  geo.translate(0, 0, -(depth - bevel * 2) / 2);
  const m = new THREE.Mesh(geo, material); m.castShadow = true; return m;
}

function wheel(group, x, y, z, r, { spokes = 0, color = '#1c1b1a', hub = '#8a8a86', width = 0.12 } = {}) {
  const w = new THREE.Group(); w.position.set(x, y, z);
  if (spokes) {
    add(w, new THREE.TorusGeometry(r, width * 0.35, 8, 28), mat(color, { roughness: 0.6 }));
    for (let i = 0; i < spokes; i++) add(w, cyl(0.012, 0.012, r * 2, 5), mat(color), 0, 0, 0, 0, 0, i * Math.PI / spokes);
    add(w, cyl(r * 0.12, r * 0.12, width, 12), mat(hub, { metalness: 0.5 }), 0, 0, 0, Math.PI / 2);
  } else {
    add(w, cyl(r, r, width, 22), mat(color, { roughness: 0.9 }), 0, 0, 0, Math.PI / 2);
    add(w, cyl(r * 0.55, r * 0.55, width + 0.01, 16), mat(hub, { metalness: 0.6, roughness: 0.4 }), 0, 0, 0, Math.PI / 2);
  }
  group.add(w); return w;
}

/* ---------------------------------------------------------------- animals */
function quadruped({ color, belly, len, back, legLen, neck, headLen, ears, mane, hump = 0, tail = 0.5, legR = 0.07 }) {
  const g = new THREE.Group(); const legs = [];
  const fur = furMat(color), under = furMat(belly);
  const body = add(g, capsule(back * 0.3, len * 0.55), fur, 0, back, 0, 0, 0, Math.PI / 2); body.scale.set(1, 1, 0.85);
  add(g, capsule(back * 0.22, len * 0.4), under, 0, back - back * 0.12, 0, 0, 0, Math.PI / 2).scale.set(1, 1, 0.8);
  if (hump) add(g, new THREE.SphereGeometry(hump, 16, 12), fur, -len * 0.05, back + back * 0.25, 0).scale.set(1.3, 1, 0.8);
  for (const [x, z] of [[len * 0.36, 0.13], [len * 0.36, -0.13], [-len * 0.34, 0.13], [-len * 0.34, -0.13]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, back - 0.05, z); g.add(pivot);
    add(pivot, cyl(legR, legR * 0.7, legLen, 8), fur, 0, -legLen / 2, 0);
    add(pivot, cyl(legR * 0.8, legR * 0.85, 0.08, 8), mat('#2a2420'), 0, -legLen + 0.02, 0);
    legs.push(pivot);
  }
  const nx = len * 0.45, ny = back + neck * 0.35;
  add(g, capsule(back * 0.13, neck), fur, nx, ny, 0, 0, 0, -0.75);
  if (mane) add(g, box(neck * 0.9, 0.06, 0.05), mat(mane), nx - 0.06, ny + 0.12, 0, 0, 0, -0.75);
  const hx = nx + neck * 0.5, hy = ny + neck * 0.42;
  add(g, capsule(back * 0.1, headLen), fur, hx + headLen * 0.25, hy - 0.04, 0, 0, 0, 1.15);
  add(g, new THREE.SphereGeometry(back * 0.1, 10, 8), under, hx + headLen * 0.62, hy - headLen * 0.32, 0);
  for (const z of [0.06, -0.06]) {
    add(g, new THREE.ConeGeometry(0.045, ears, 6), fur, hx - 0.02, hy + back * 0.12 + ears / 2, z, z * 3, 0, -0.25);
    add(g, new THREE.SphereGeometry(0.018, 6, 6), mat('#0b0a09', { roughness: 0.2 }), hx + 0.12, hy + 0.05, z * 1.2);
  }
  add(g, cyl(0.02, 0.012, tail, 6), fur, -len * 0.55, back - tail * 0.35, 0, 0, 0, 0.35);
  add(g, capsule(0.04, 0.12), mat(mane || '#3a3028'), -len * 0.62, back - tail * 0.75, 0, 0, 0, 0.2);
  return { group: g, legs };
}
const donkey = () => { const a = quadruped({ color: '#8d857a', belly: '#d8d0c2', len: 1.3, back: 0.95, legLen: 0.82, neck: 0.32, headLen: 0.32, ears: 0.3, mane: '#3b352f' }); add(a.group, box(0.55, 0.06, 0.62), texMat('blanket'), 0, 1.22, 0); return { ...a, height: 1.55, length: 1.6, seat: 1.18 }; };
const horse = () => { const a = quadruped({ color: '#6b4a32', belly: '#7a5638', len: 1.75, back: 1.35, legLen: 1.15, neck: 0.55, headLen: 0.45, ears: 0.14, mane: '#1f1712', legR: 0.08 }); add(a.group, box(0.6, 0.07, 0.66), mat('#3a2418', { roughness: 0.5 }), 0, 1.68, 0); return { ...a, height: 2.1, length: 2.3, seat: 1.65 }; };
const camel = () => { const a = quadruped({ color: '#c49a63', belly: '#d8b585', len: 1.7, back: 1.65, legLen: 1.5, neck: 0.8, headLen: 0.4, ears: 0.08, hump: 0.42, legR: 0.07 }); add(a.group, box(0.8, 0.1, 0.8), texMat('blanket'), -0.05, 2.32, 0); return { ...a, height: 2.6, length: 2.5, seat: 2.3 }; };

/* ---------------------------------------------------------------- vehicles */
function carriage() {
  const h = horse(); const g = new THREE.Group(); g.add(h.group); h.group.position.x = 1.6;
  const wood = mat('#2b1d14', { roughness: 0.55 }), black = mat('#141210', { roughness: 0.5 });
  add(g, box(1.6, 0.75, 1.3), wood, -0.9, 1.15, 0);
  add(g, box(0.5, 0.5, 1.2), wood, 0.1, 1.05, 0);
  const hood = add(g, new THREE.CylinderGeometry(0.75, 0.75, 1.32, 16, 1, true, 0, Math.PI), black, -1.2, 1.5, 0, Math.PI / 2, 0, 0); hood.material.side = THREE.DoubleSide;
  add(g, box(2.2, 0.05, 0.05), mat('#6b5236'), 0.95, 1.0, 0.45); add(g, box(2.2, 0.05, 0.05), mat('#6b5236'), 0.95, 1.0, -0.45);
  const wheels = [wheel(g, -1.3, 0.62, 0.72, 0.62, { spokes: 12, color: '#3a2618' }), wheel(g, -1.3, 0.62, -0.72, 0.62, { spokes: 12, color: '#3a2618' }), wheel(g, -0.1, 0.45, 0.68, 0.45, { spokes: 10, color: '#3a2618' }), wheel(g, -0.1, 0.45, -0.68, 0.45, { spokes: 10, color: '#3a2618' })];
  return { group: g, legs: h.legs, wheels, height: 2.4, length: 4.8, seat: 1.6 };
}
function cart(animal = donkey) {
  const a = animal(); const g = new THREE.Group(); g.add(a.group); a.group.position.x = 1.35;
  add(g, box(1.6, 0.12, 1.1), texMat('wood'), -0.6, 0.85, 0);
  for (const z of [0.52, -0.52]) add(g, box(1.6, 0.3, 0.06), texMat('wood'), -0.6, 1.05, z);
  add(g, box(1.8, 0.06, 0.06), texMat('wood'), 0.6, 0.9, 0.35); add(g, box(1.8, 0.06, 0.06), texMat('wood'), 0.6, 0.9, -0.35);
  const wheels = [wheel(g, -0.7, 0.62, 0.65, 0.62, { spokes: 10, color: '#4a3220' }), wheel(g, -0.7, 0.62, -0.65, 0.62, { spokes: 10, color: '#4a3220' })];
  return { group: g, legs: a.legs, wheels, height: 1.6, length: 3.6, seat: 1.2 };
}
function wagon() {
  const c = cart(horse); add(c.group, new THREE.CylinderGeometry(0.62, 0.62, 1.7, 16, 1, true, 0, Math.PI), mat('#e6dcc4', { side: THREE.DoubleSide }), -0.6, 1.2, 0, 0, 0, Math.PI / 2);
  return { ...c, height: 2.2, length: 4.2 };
}
function vintageCar() {
  const g = new THREE.Group(); const black = mat('#141414', { roughness: 0.35, metalness: 0.3 });
  g.add(profile([[-1.7, 0.55], [1.45, 0.55], [1.55, 0.95], [0.5, 1.05], [0.1, 1.05], [0.1, 1.95], [-1.1, 1.95], [-1.25, 1.1], [-1.7, 1.0]], 1.45, black, 0.05));
  add(g, box(0.06, 0.55, 1.2), mat('#2a3036', { roughness: 0.1, metalness: 0.5 }), 0.12, 1.5, 0);
  add(g, box(0.12, 0.42, 0.5), mat('#b08d57', { metalness: 0.8, roughness: 0.3 }), 1.55, 0.92, 0);
  for (const z of [0.42, -0.42]) add(g, cyl(0.1, 0.1, 0.12, 14), mat('#e8e2cf', { emissive: '#fff1c4', emissiveIntensity: 0.2 }), 1.55, 1.12, z, 0, 0, Math.PI / 2);
  for (const z of [0.82, -0.82]) add(g, box(1.6, 0.05, 0.25), black, -0.1, 0.5, z);
  const wheels = [];
  for (const x of [1.05, -1.25]) for (const z of [0.72, -0.72]) wheels.push(wheel(g, x, 0.38, z, 0.38, { spokes: 12, color: '#1a1918', hub: '#c9b07a' }));
  return { group: g, wheels, height: 1.95, length: 3.4, seat: 1.2 };
}
function car70(color = ['#d9822b', '#6a994e', '#e8d44d', '#3e7cb1', '#f2e8cf', '#bc4749'][Math.floor(Math.random() * 6)]) {
  const g = new THREE.Group(); const paint = mat(color, { roughness: 0.4, metalness: 0.2 });
  g.add(profile([[-2.1, 0.32], [2.1, 0.32], [2.15, 0.78], [1.0, 0.86], [0.55, 1.33], [-0.95, 1.33], [-1.4, 0.88], [-2.1, 0.84]], 1.62, paint, 0.06));
  const glass = profile([[1.0, 0.86], [0.58, 1.28], [-0.92, 1.28], [-1.32, 0.88]], 1.66, mat('#1b2229', { roughness: 0.1, metalness: 0.4 }), 0.01); g.add(glass);
  add(g, box(0.05, 0.12, 1.5), mat('#c9c9c4', { metalness: 0.8, roughness: 0.3 }), 2.17, 0.42, 0);
  add(g, box(0.05, 0.12, 1.5), mat('#c9c9c4', { metalness: 0.8, roughness: 0.3 }), -2.13, 0.42, 0);
  for (const z of [0.55, -0.55]) add(g, cyl(0.09, 0.09, 0.04, 14), mat('#f4efe0', { emissive: '#fff4d0', emissiveIntensity: 0.2 }), 2.16, 0.65, z, 0, 0, Math.PI / 2);
  const wheels = [];
  for (const x of [1.35, -1.35]) for (const z of [0.72, -0.72]) wheels.push(wheel(g, x, 0.31, z, 0.31, { hub: '#d0d0cc', width: 0.18 }));
  return { group: g, wheels, height: 1.4, length: 4.3, seat: 0.9 };
}
function bus(era) {
  const g = new THREE.Group(); const old = era === 'bus_old';
  const lower = mat(old ? '#6f7d4f' : '#2f7a55', { roughness: 0.5, metalness: 0.1 }), cream = mat('#ece3cb', { roughness: 0.55 });
  const glass = mat('#2a3238', { roughness: 0.08, metalness: 0.5 }), trim = mat('#b9b4a6', { metalness: 0.7, roughness: 0.35 });
  const L = old ? 6.5 : 10.5, H = old ? 2.7 : 3.0, Wd = 2.4, belt = H * 0.42;
  g.add(profile([[-L / 2, 0.42], [L / 2 - 0.35, 0.42], [L / 2, 0.8], [L / 2, belt], [-L / 2, belt]], Wd, lower, 0.04));
  g.add(profile([[-L / 2, belt], [L / 2, belt], [L / 2, H - 0.35], [L / 2 - 0.3, H], [-L / 2 + 0.15, H], [-L / 2, H - 0.15]], Wd - 0.04, cream, 0.04));
  // Window panes with cream pillars between them, both sides and the windscreen.
  const n = old ? 5 : 8, span = L - 1.4, pane = span / n;
  for (let i = 0; i < n; i++) for (const z of [Wd / 2 - 0.01, -Wd / 2 + 0.01]) add(g, box(pane * 0.8, (H - belt) * 0.55, 0.04), glass, -L / 2 + 0.6 + pane * (i + 0.5), belt + (H - belt) * 0.45, z);
  add(g, box(0.04, (H - belt) * 0.55, Wd * 0.8), glass, L / 2 + 0.06, belt + (H - belt) * 0.42, 0);
  add(g, box(L + 0.05, 0.08, Wd + 0.03), trim, 0, belt, 0);
  add(g, box(0.08, 0.25, Wd * 0.9), trim, L / 2 + 0.04, 0.6, 0);
  for (const z of [0.85, -0.85]) add(g, cyl(0.12, 0.12, 0.05, 14), mat('#f4efe0', { emissive: '#fff4d0', emissiveIntensity: 0.25 }), L / 2 + 0.03, 0.85, z, 0, 0, Math.PI / 2);
  if (old) add(g, box(L * 0.7, 0.12, Wd * 0.8), mat('#3a3a36'), -0.3, H + 0.08, 0);
  const wheels = [];
  for (const x of [L / 2 - 1.3, -L / 2 + 1.5]) for (const z of [1.05, -1.05]) wheels.push(wheel(g, x, 0.5, z, 0.5, { spokes: old ? 10 : 0, width: 0.25 }));
  return { group: g, wheels, height: H, length: L, seat: 1.2 };
}
function scooter() {
  const g = new THREE.Group(); const paint = mat('#9cc7c9', { roughness: 0.35, metalness: 0.2 });
  g.add(profile([[-0.75, 0.3], [-0.2, 0.3], [0.3, 0.42], [0.45, 1.05], [0.62, 1.05], [0.6, 0.92], [0.42, 0.35], [0.75, 0.3], [0.75, 0.2], [-0.75, 0.2], [-0.85, 0.55, -0.55, 0.72], [-0.2, 0.72]], 0.5, paint, 0.05));
  add(g, box(0.62, 0.1, 0.32), mat('#3a2b22', { roughness: 0.6 }), -0.45, 0.78, 0);
  add(g, cyl(0.02, 0.02, 0.6), mat('#c9c9c4', { metalness: 0.8 }), 0.55, 1.08, 0, Math.PI / 2);
  add(g, cyl(0.07, 0.07, 0.05, 12), mat('#f4efe0', { emissive: '#fff4d0', emissiveIntensity: 0.2 }), 0.65, 0.98, 0, 0, 0, Math.PI / 2);
  const wheels = [wheel(g, 0.6, 0.2, 0, 0.2, { width: 0.1 }), wheel(g, -0.55, 0.2, 0, 0.2, { width: 0.1 })];
  return { group: g, wheels, height: 1.15, length: 1.7, seat: 0.82 };
}
function bicycleOld() {
  const g = new THREE.Group(); const iron = mat('#1a1a1a', { roughness: 0.4, metalness: 0.5 });
  const wheels = [wheel(g, 0.55, 0.36, 0, 0.36, { spokes: 16, color: '#1a1a1a' }), wheel(g, -0.55, 0.36, 0, 0.36, { spokes: 16, color: '#1a1a1a' })];
  add(g, cyl(0.02, 0.02, 1.1), iron, 0, 0.62, 0, 0, 0, Math.PI / 2 - 0.3); add(g, cyl(0.02, 0.02, 0.6), iron, -0.25, 0.65, 0, 0, 0, 0.35);
  add(g, box(0.25, 0.06, 0.12), mat('#3a2418'), -0.3, 0.95, 0); add(g, cyl(0.015, 0.015, 0.5), iron, 0.5, 1.0, 0, Math.PI / 2);
  return { group: g, wheels, height: 1.05, length: 1.7, seat: 0.92 };
}
function pod() {
  const g = new THREE.Group();
  add(g, new THREE.CapsuleGeometry(0.75, 2.3, 8, 18), mat('#f2f6f7', { roughness: 0.15, metalness: 0.1 }), 0, 1.0, 0, 0, 0, Math.PI / 2).scale.set(1, 0.85, 1.05);
  add(g, new THREE.SphereGeometry(0.75, 18, 12), mat('#14262c', { roughness: 0.05, metalness: 0.6 }), 0.35, 1.32, 0).scale.set(1.6, 0.6, 1.0);
  add(g, box(3.0, 0.03, 1.2), mat('#7ff5e1', { emissive: '#4ff5e6', emissiveIntensity: 2 }), 0, 0.33, 0);
  return { group: g, height: 1.75, length: 3.9, seat: 0.9, hover: 0.25 };
}
function hoverbike() {
  const g = new THREE.Group();
  g.add(profile([[-0.9, 0.45], [0.7, 0.45], [1.0, 0.7], [0.5, 0.95], [-0.2, 0.8], [-0.9, 0.75]], 0.5, mat('#e6eef0', { roughness: 0.2, metalness: 0.4 }), 0.06));
  for (const x of [0.6, -0.6]) add(g, new THREE.TorusGeometry(0.22, 0.05, 8, 20), mat('#7ff5e1', { emissive: '#4ff5e6', emissiveIntensity: 2 }), x, 0.3, 0, Math.PI / 2);
  return { group: g, height: 1.0, length: 1.9, seat: 0.88, hover: 0.15 };
}

/* ---------------------------------------------------------------- street furniture */
function stone() {
  const g = new THREE.Group(); const geo = new THREE.BoxGeometry(1.5, 0.48, 0.6, 6, 3, 3);
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (1 + (Math.random() - 0.5) * 0.06), p.getY(i) + (Math.random() - 0.5) * 0.04, p.getZ(i) * (1 + (Math.random() - 0.5) * 0.08));
  geo.computeVertexNormals(); add(g, geo, texMat('stone'), 0, 0.24, 0);
  return { group: g, height: 0.5, length: 1.5, seat: 0.48 };
}
function benchWood(iron = false) {
  const g = new THREE.Group(); const wood = texMat('wood', iron ? '#6a4a30' : '#ffffff'), metal = mat(iron ? '#1f2421' : '#2a2a2a', { metalness: 0.6, roughness: 0.45 });
  for (let i = 0; i < 4; i++) add(g, box(1.8, 0.035, 0.09), wood, 0, 0.45, -0.18 + i * 0.12);
  for (let i = 0; i < 3; i++) add(g, box(1.8, 0.09, 0.035), wood, 0, 0.62 + i * 0.13, -0.27, -0.18);
  for (const x of [-0.75, 0.75]) {
    add(g, box(0.06, 0.45, 0.06), metal, x, 0.22, 0.2); add(g, box(0.06, 0.88, 0.06), metal, x, 0.44, -0.24, -0.18);
    add(g, box(0.06, 0.05, 0.5), metal, x, 0.43, -0.02);
    if (iron) { add(g, new THREE.TorusGeometry(0.16, 0.025, 6, 16, Math.PI), metal, x, 0.62, 0.12, 0, Math.PI / 2, 0); add(g, new THREE.TorusGeometry(0.08, 0.02, 6, 12), metal, x, 0.2, 0.02, 0, Math.PI / 2, 0); }
  }
  return { group: g, height: 0.95, length: 1.8, seat: 0.47 };
}
function benchConcrete() {
  const g = new THREE.Group(); const c = texMat('concrete');
  add(g, box(1.9, 0.1, 0.5), texMat('wood', '#c9a77a'), 0, 0.45, 0);
  for (const x of [-0.75, 0.75]) add(g, box(0.18, 0.4, 0.45), c, x, 0.2, 0);
  return { group: g, height: 0.5, length: 1.9, seat: 0.48 };
}
function benchFuture() {
  const g = new THREE.Group();
  g.add(profile([[-1, 0], [1, 0], [1, 0.08], [0.95, 0.42], [-0.95, 0.42], [-1, 0.08]], 0.55, mat('#eef3f4', { roughness: 0.2 }), 0.08));
  add(g, box(1.9, 0.02, 0.5), mat('#7ff5e1', { emissive: '#4ff5e6', emissiveIntensity: 1.5 }), 0, 0.03, 0);
  add(g, box(0.5, 0.25, 0.5), mat('#4f8a5b'), -0.7, 0.55, 0);
  return { group: g, height: 0.8, length: 2, seat: 0.48 };
}
function stool() { const g = new THREE.Group(); add(g, cyl(0.22, 0.22, 0.06, 14), texMat('wood'), 0, 0.42, 0); for (let i = 0; i < 3; i++) { const a = i * 2.1; add(g, cyl(0.025, 0.025, 0.45, 6), texMat('wood'), Math.cos(a) * 0.15, 0.2, Math.sin(a) * 0.15, Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2); } return { group: g, height: 0.45, length: 0.5, seat: 0.45 }; }
function lamp(kind) {
  const g = new THREE.Group(); const iron = mat('#1c1f1d', { metalness: 0.6, roughness: 0.4 }); const H = kind === 'lamp_gas' ? 3.6 : 2.6;
  add(g, cyl(0.05, 0.08, H, 10), kind === 'lamp_gas' ? iron : texMat('wood'), 0, H / 2, 0);
  add(g, cyl(0.15, 0.12, 0.3, 6), mat('#ffd38a', { emissive: '#ffb347', emissiveIntensity: 1.6, transparent: true, opacity: 0.9 }), 0, H + 0.12, 0);
  add(g, new THREE.ConeGeometry(0.22, 0.2, 6), iron, 0, H + 0.36, 0);
  return { group: g, height: H + 0.5, length: 0.45, seat: 0, glow: true };
}

const BUILDERS = {
  donkey, horse, camel, carriage, cart: () => cart(donkey), wagon,
  vintage_car: vintageCar, car70: () => car70(), bus_old: () => bus('bus_old'), bus70: () => bus('bus70'),
  scooter, bicycle_old: bicycleOld, pod, hoverbike,
  stone, bench_wood: () => benchWood(false), bench_iron: () => benchWood(true), bench_concrete: benchConcrete, bench_future: benchFuture,
  stool, lamp_oil: () => lamp('lamp_oil'), lamp_gas: () => lamp('lamp_gas'),
};
export const PROP_KINDS = Object.keys(BUILDERS);

/** Build a model by kind. Returns { group, height, length, seat, legs?, wheels?, hover?, glow? }. */
export function buildProp(kind) {
  const b = BUILDERS[kind]; if (!b) return null;
  const m = b(); m.kind = kind;
  m.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return m;
}

/** Hebrew names, for the detections list. */
export const PROP_NAMES = {
  donkey: 'חמור', horse: 'סוס', camel: 'גמל', carriage: 'כרכרה', cart: 'עגלה', wagon: 'עגלת משא', vintage_car: 'מכונית וינטג׳',
  car70: 'מכונית משנות ה-70', bus_old: 'אוטובוס ישן', bus70: 'אוטובוס משנות ה-70', scooter: 'קטנוע וספה', bicycle_old: 'אופניים ישנים',
  pod: 'רכב אוטונומי', hoverbike: 'אופנוע מרחף', stone: 'אבן גיר', bench_wood: 'ספסל עץ', bench_iron: 'ספסל ברזל יצוק',
  bench_concrete: 'ספסל בטון', bench_future: 'ספסל חכם', stool: 'שרפרף', lamp_oil: 'פנס נפט', lamp_gas: 'פנס גז', remove: 'הוסר',
};
