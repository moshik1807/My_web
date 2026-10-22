// Period clothing drawn onto real people. Garments follow the body outline from pose landmarks
// (shoulders, hips, knees, ankles, arms), so a robe sits, walks and turns with the wearer.
// Headwear is anchored to the ears and tilts with the head.

const L = { nose: 0, earL: 7, earR: 8, shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16, hipL: 23, hipR: 24, knL: 25, knR: 26, anL: 27, anR: 28 };
const V = (x, y) => ({ x, y });
const add = (a, b, k = 1) => V(a.x + b.x * k, a.y + b.y * k);
const sub = (a, b) => V(a.x - b.x, a.y - b.y);
const mid = (a, b) => V((a.x + b.x) / 2, (a.y + b.y) / 2);
const len = (a) => Math.hypot(a.x, a.y);
const norm = (a) => { const l = len(a) || 1; return V(a.x / l, a.y / l); };
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16), f = (c) => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

const patterns = new Map();
function fabric(ctx, kind, color, scale) {
  const key = `${kind}|${color}|${Math.round(scale)}`;
  if (patterns.has(key)) return patterns.get(key);
  const s = Math.max(8, Math.round(scale)), c = document.createElement('canvas'); c.width = c.height = s * 4;
  const g = c.getContext('2d'); const S = s * 4;
  g.fillStyle = color; g.fillRect(0, 0, S, S);
  if (kind === 'stripes') { for (let x = 0; x < S; x += s) { g.fillStyle = shade(color, 0.72); g.fillRect(x, 0, s * 0.18, S); g.fillStyle = shade(color, 1.15); g.fillRect(x + s * 0.5, 0, s * 0.06, S); } }
  if (kind === 'tweed') { for (let i = 0; i < S * S / 6; i++) { g.fillStyle = Math.random() > 0.5 ? shade(color, 0.8) : shade(color, 1.18); g.fillRect(Math.random() * S, Math.random() * S, 1, 2); } }
  if (kind === 'embroidery' || kind === 'panel') {
    // Plain woven cloth; the cross-stitch panel itself is drawn on the chest and hem.
    for (let i = 0; i < S * S / 8; i++) { g.fillStyle = Math.random() > 0.5 ? shade(color, 0.85) : shade(color, 1.12); g.fillRect(Math.random() * S, Math.random() * S, 1, 1); }
    if (kind === 'panel') { g.fillStyle = shade(color, 0.6); g.fillRect(0, 0, S, S); for (let y = 0; y < S; y += s * 0.5) for (let x = (y / (s * 0.5)) % 2 ? s * 0.25 : 0; x < S; x += s * 0.5) { g.fillStyle = ['#a8322a', '#c9832e', '#2f5b3f'][Math.floor((x + y) / s) % 3]; g.fillRect(x, y, s * 0.2, s * 0.2); } }
  }
  if (kind === 'floral') { for (let i = 0; i < 18; i++) { const x = Math.random() * S, y = Math.random() * S; g.fillStyle = ['#f4e3b5', '#c4562b', '#2f5b3f'][i % 3]; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x + Math.cos(k * 1.26) * s * 0.18, y + Math.sin(k * 1.26) * s * 0.18, s * 0.12, 0, 6.3); g.fill(); } } }
  if (kind === 'smart') { g.strokeStyle = 'rgba(79,245,230,0.55)'; g.lineWidth = Math.max(1, s * 0.06); for (let y = s; y < S; y += s * 1.5) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); } }
  if (kind === 'check') { g.strokeStyle = shade(color, 0.55); g.lineWidth = Math.max(1, s * 0.08); for (let i = 0; i < S; i += s * 0.5) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); } }
  for (let i = 0; i < S * S / 20; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.fillRect(Math.random() * S, Math.random() * S, 1, 1); }
  const p = ctx.createPattern(c, 'repeat'); patterns.set(key, p); return p;
}

/** Body geometry in screen pixels from pose landmarks; null when the torso is not visible. */
export function bodyGeometry(lm, toScreen) {
  const P = (i) => { const p = lm[i]; const s = toScreen(p.x, p.y); s.v = p.visibility ?? 1; return s; };
  const pts = {}; for (const k in L) pts[k] = P(L[k]);
  if (pts.shL.v < 0.4 || pts.shR.v < 0.4) return null;
  const sw = len(sub(pts.shL, pts.shR));
  if (sw < 6) return null;
  const midS = mid(pts.shL, pts.shR);
  const hipsOk = pts.hipL.v > 0.3 && pts.hipR.v > 0.3;
  const midH = hipsOk ? mid(pts.hipL, pts.hipR) : add(midS, V(0, sw * 1.35));
  if (!hipsOk) { pts.hipL = add(pts.shL, V(0, sw * 1.35)); pts.hipR = add(pts.shR, V(0, sw * 1.35)); }
  const up = norm(sub(midS, midH)), torso = len(sub(midS, midH));
  for (const [k, h, a] of [['knL', 'hipL', 'anL'], ['knR', 'hipR', 'anR']]) {
    if (pts[k].v < 0.3) pts[k] = add(pts[h], up, -torso * 0.95);
    if (pts[a].v < 0.3) pts[a] = add(pts[k], sub(pts[k], pts[h]), 0.95);
  }
  const earsOk = pts.earL.v > 0.3 && pts.earR.v > 0.3;
  const earMid = earsOk ? mid(pts.earL, pts.earR) : (pts.nose.v > 0.3 ? add(pts.nose, up, -sw * 0.05) : add(midS, up, sw * 0.6));
  const headR = Math.max(earsOk ? len(sub(pts.earL, pts.earR)) * 0.62 : 0, sw * 0.27);
  const tilt = earsOk && len(sub(pts.earL, pts.earR)) > sw * 0.25 ? Math.atan2(pts.earL.y - pts.earR.y, pts.earL.x - pts.earR.x) : Math.atan2(up.x, -up.y);
  return { pts, sw, midS, midH, up, torso, head: { c: earMid, r: headR, tilt: normalizeTilt(tilt) } };
}
function normalizeTilt(a) { while (a > Math.PI / 2) a -= Math.PI; while (a < -Math.PI / 2) a += Math.PI; return a; }

/** Outline polygon of a garment from shoulders down to `bottom` ('hip' | 'knee' | 'ankle'). */
function outline(b, bottom, flare) {
  const { pts, sw, midS, midH } = b;
  const out = (p, center, k) => add(p, norm(sub(p, center)), sw * k);
  const right = [out(pts.shR, midS, 0.1), out(pts.hipR, midH, 0.16)];
  const left = [out(pts.shL, midS, 0.1), out(pts.hipL, midH, 0.16)];
  if (bottom === 'hip') {
    right.push(add(right[1], b.up, -sw * 0.35)); left.push(add(left[1], b.up, -sw * 0.35));
  } else {
    const midK = mid(pts.knR, pts.knL);
    right.push(out(pts.knR, midK, bottom === 'knee' ? 0.32 : 0.22)); left.push(out(pts.knL, midK, bottom === 'knee' ? 0.32 : 0.22));
    if (bottom === 'ankle') {
      const midA = mid(pts.anR, pts.anL);
      right.push(add(out(pts.anR, midA, 0.3 + flare), b.up, -sw * 0.05)); left.push(add(out(pts.anL, midA, 0.3 + flare), b.up, -sw * 0.05));
    }
  }
  return { left, right };
}
function tracePoly(ctx, left, right, neck) {
  ctx.beginPath(); ctx.moveTo(neck.x, neck.y);
  const draw = (arr) => { for (let i = 0; i < arr.length; i++) { const p = arr[i], q = arr[i + 1]; if (q) { const m = mid(p, q); ctx.quadraticCurveTo(p.x, p.y, m.x, m.y); } else ctx.lineTo(p.x, p.y); } };
  ctx.lineTo(right[0].x, right[0].y); draw(right);
  const hemR = right[right.length - 1], hemL = left[left.length - 1], hemMid = mid(hemR, hemL);
  ctx.quadraticCurveTo(hemMid.x, hemMid.y + 4, hemL.x, hemL.y);
  draw([...left].reverse()); ctx.closePath();
}
function bodyShading(ctx, b, extent) {
  const p = V(-b.up.y, b.up.x), c = b.midH, w = b.sw * 1.1;
  const g = ctx.createLinearGradient(c.x - p.x * w, c.y - p.y * w, c.x + p.x * w, c.y + p.y * w);
  g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(0.3, 'rgba(0,0,0,0.05)'); g.addColorStop(0.55, 'rgba(255,255,255,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g; ctx.fill();
  const top = b.midS, bot = add(b.midH, b.up, -b.torso * extent);
  const v = ctx.createLinearGradient(top.x, top.y, bot.x, bot.y);
  v.addColorStop(0, 'rgba(255,255,255,0.05)'); v.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = v; ctx.fill();
}
function folds(ctx, b, from, to, n) {
  ctx.save(); ctx.clip(); ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = Math.max(1, b.sw * 0.03);
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1) - 0.5, p = V(-b.up.y, b.up.x);
    const a = add(from, p, t * b.sw * 0.9), z = add(to, p, t * b.sw * 1.5);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + z.x) / 2 + t * 6, (a.y + z.y) / 2, z.x, z.y); ctx.stroke();
  }
  ctx.restore();
}
function sleeves(ctx, b, paint) {
  const { pts, sw } = b;
  for (const [s, e, w] of [['shL', 'elL', 'wrL'], ['shR', 'elR', 'wrR']]) {
    if (pts[e].v < 0.3) continue;
    const wr = pts[w].v > 0.3 ? add(pts[e], sub(pts[w], pts[e]), 0.82) : pts[e];
    ctx.beginPath(); ctx.moveTo(pts[s].x, pts[s].y); ctx.lineTo(pts[e].x, pts[e].y); ctx.lineTo(wr.x, wr.y);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = paint; ctx.lineWidth = sw * 0.3; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = sw * 0.3; ctx.globalCompositeOperation = 'source-atop';
    ctx.beginPath(); ctx.moveTo(pts[s].x + sw * 0.06, pts[s].y); ctx.lineTo(pts[e].x + sw * 0.06, pts[e].y); ctx.lineTo(wr.x + sw * 0.06, wr.y); ctx.lineWidth = sw * 0.1; ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
}

function drawGarment(ctx, b, c, seed) {
  const color = c.fabric[seed % c.fabric.length];
  const paint = fabric(ctx, c.pattern || 'plain', color, b.sw * 0.18);
  const neck = add(b.midS, b.up, b.sw * 0.12);
  const kind = c.garment;
  const shape = kind === 'robe' ? outline(b, 'ankle', 0.12) : kind === 'dress' ? outline(b, 'ankle', 0.3) : kind === 'coat' ? outline(b, 'knee', 0) : outline(b, 'hip', 0);
  sleeves(ctx, b, paint);
  tracePoly(ctx, shape.left, shape.right, neck);
  ctx.fillStyle = paint; ctx.fill();
  bodyShading(ctx, b, kind === 'suit' ? 0.3 : 1.6);
  const hem = mid(shape.left[shape.left.length - 1], shape.right[shape.right.length - 1]);
  tracePoly(ctx, shape.left, shape.right, neck);
  folds(ctx, b, b.midH, hem, kind === 'robe' || kind === 'dress' ? 4 : 2);
  const p = V(-b.up.y, b.up.x);
  if (kind === 'suit' || kind === 'coat') {
    // Shirt, tie and lapels.
    const v0 = add(b.midS, b.up, b.sw * 0.08), v1 = add(b.midS, b.up, -b.torso * 0.45);
    ctx.beginPath(); ctx.moveTo(add(v0, p, -b.sw * 0.17).x, add(v0, p, -b.sw * 0.17).y); ctx.lineTo(v1.x, v1.y); ctx.lineTo(add(v0, p, b.sw * 0.17).x, add(v0, p, b.sw * 0.17).y); ctx.closePath();
    ctx.fillStyle = '#ece6d8'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(v0.x, v0.y); ctx.lineTo(add(v1, b.up, b.torso * 0.08).x, add(v1, b.up, b.torso * 0.08).y); ctx.strokeStyle = seed % 2 ? '#5b1f1f' : '#22283a'; ctx.lineWidth = b.sw * 0.07; ctx.stroke();
    ctx.fillStyle = 'rgba(20,16,12,0.8)';
    for (let i = 0; i < 3; i++) { const q = add(v1, b.up, -b.torso * (0.1 + i * 0.22)); ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1, b.sw * 0.025), 0, 6.3); ctx.fill(); }
  } else if (kind === 'dress' || kind === 'robe') {
    if (c.pattern === 'embroidery') {
      // Cross-stitched chest panel (qabbeh) and hem band of a Palestinian thobe.
      const panel = fabric(ctx, 'panel', color, b.sw * 0.18);
      const top = add(b.midS, b.up, -b.sw * 0.05), bot = add(b.midS, b.up, -b.torso * 0.55);
      ctx.beginPath(); for (const [q, k] of [[top, -0.28], [top, 0.28], [bot, 0.24], [bot, -0.24]]) { const v = add(q, p, b.sw * k); ctx.lineTo(v.x, v.y); } ctx.closePath();
      ctx.fillStyle = panel; ctx.fill();
      const hl = shape.left[shape.left.length - 1], hr = shape.right[shape.right.length - 1];
      ctx.beginPath(); ctx.moveTo(hl.x, hl.y); ctx.lineTo(hr.x, hr.y); ctx.lineTo(add(hr, b.up, b.torso * 0.25).x, add(hr, b.up, b.torso * 0.25).y); ctx.lineTo(add(hl, b.up, b.torso * 0.25).x, add(hl, b.up, b.torso * 0.25).y); ctx.closePath();
      ctx.save(); tracePoly(ctx, shape.left, shape.right, neck); ctx.clip(); ctx.fillStyle = panel; ctx.beginPath(); ctx.moveTo(hl.x, hl.y); ctx.lineTo(hr.x, hr.y); ctx.lineTo(add(hr, b.up, b.torso * 0.25).x, add(hr, b.up, b.torso * 0.25).y); ctx.lineTo(add(hl, b.up, b.torso * 0.25).x, add(hl, b.up, b.torso * 0.25).y); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    const w = add(b.midH, b.up, b.torso * 0.15);
    ctx.beginPath(); ctx.moveTo(add(w, p, -b.sw * 0.62).x, add(w, p, -b.sw * 0.62).y); ctx.lineTo(add(w, p, b.sw * 0.62).x, add(w, p, b.sw * 0.62).y);
    ctx.strokeStyle = kind === 'robe' ? 'rgba(60,40,25,0.75)' : '#8a2a22'; ctx.lineWidth = b.sw * 0.08; ctx.stroke();
  }
}

function drawHeadwear(ctx, b, kind, color, seed) {
  if (!kind) return;
  const { c, r, tilt } = b.head;
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(tilt);
  const grad = (base, a = 0.75, z = 1.15) => { const g = ctx.createLinearGradient(-r * 1.5, 0, r * 1.5, 0); g.addColorStop(0, shade(base, a)); g.addColorStop(0.45, shade(base, z)); g.addColorStop(1, shade(base, a * 0.9)); return g; };
  const ell = (x, y, rx, ry, fill) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
  if (kind === 'tarbush') {
    ctx.beginPath(); ctx.moveTo(-r * 0.88, -r * 0.62); ctx.lineTo(-r * 0.7, -r * 1.72); ctx.lineTo(r * 0.7, -r * 1.72); ctx.lineTo(r * 0.88, -r * 0.62); ctx.closePath();
    ctx.fillStyle = grad('#9e1d1d'); ctx.fill(); ell(0, -r * 1.72, r * 0.7, r * 0.12, '#6e1212');
    ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.5, r * 0.07); ctx.beginPath(); ctx.moveTo(0, -r * 1.72); ctx.quadraticCurveTo(r * 0.6, -r * 1.6, r * 0.78, -r * 0.95); ctx.stroke();
  } else if (kind === 'keffiyeh' || kind === 'headscarf') {
    const cloth = kind === 'keffiyeh' ? (color || '#f1ece2') : (color || '#efe9dc');
    ctx.beginPath();
    ctx.moveTo(-r * 1.15, -r * 0.2); ctx.quadraticCurveTo(-r * 1.25, -r * 1.55, 0, -r * 1.6); ctx.quadraticCurveTo(r * 1.25, -r * 1.55, r * 1.15, -r * 0.2);
    ctx.quadraticCurveTo(r * 1.5, r * 1.4, r * 1.9, r * 2.4); ctx.lineTo(-r * 1.9, r * 2.4); ctx.quadraticCurveTo(-r * 1.5, r * 1.4, -r * 1.15, -r * 0.2);
    ctx.moveTo(r * 0.78, -r * 0.1); ctx.ellipse(0, r * 0.05, r * 0.78, r * 1.05, 0, 0, Math.PI * 2, true);
    ctx.fillStyle = kind === 'keffiyeh' ? fabric(ctx, 'check', cloth, r * 0.5) : grad(cloth, 0.8, 1.05); ctx.fill('evenodd');
    if (kind === 'keffiyeh') { ctx.strokeStyle = '#141210'; ctx.lineWidth = r * 0.12; for (const dy of [0, 0.16]) { ctx.beginPath(); ctx.ellipse(0, -r * (1.0 + dy), r * 1.08, r * 0.24, 0, 0, Math.PI * 2); ctx.stroke(); } }
  } else if (kind === 'fedora' || kind === 'cowboy') {
    const wide = kind === 'cowboy';
    ell(0, -r * 0.82, r * (wide ? 2.0 : 1.55), r * 0.24, grad(color || '#2b2622', 0.7, 1.1));
    ctx.beginPath(); ctx.moveTo(-r * 0.95, -r * 0.82); ctx.quadraticCurveTo(-r * 1.0, -r * 1.85, -r * 0.2, -r * 1.75); ctx.lineTo(0, -r * 1.6); ctx.lineTo(r * 0.2, -r * 1.75); ctx.quadraticCurveTo(r * 1.0, -r * 1.85, r * 0.95, -r * 0.82); ctx.closePath();
    ctx.fillStyle = grad(color || '#2b2622'); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(-r * 0.96, -r * 1.08, r * 1.92, r * 0.2);
  } else if (kind === 'flatcap') {
    ctx.beginPath(); ctx.moveTo(-r * 1.0, -r * 0.75); ctx.quadraticCurveTo(-r * 1.05, -r * 1.45, 0, -r * 1.45); ctx.quadraticCurveTo(r * 1.15, -r * 1.45, r * 1.05, -r * 0.75); ctx.closePath();
    ctx.fillStyle = fabric(ctx, 'tweed', color || '#4a4238', r * 0.3); ctx.fill(); ctx.fillStyle = grad('#000000', 0, 0); ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1;
    ell(r * 0.15, -r * 0.72, r * 1.05, r * 0.16, shade(color || '#4a4238', 0.7));
  } else if (kind === 'tophat' || kind === 'bowler') {
    ell(0, -r * 0.82, r * 1.45, r * 0.22, '#121110');
    if (kind === 'tophat') { ctx.fillStyle = grad('#1a1918', 0.6, 1.4); ctx.fillRect(-r * 0.9, -r * 2.55, r * 1.8, r * 1.75); ell(0, -r * 2.55, r * 0.9, r * 0.14, '#222'); ctx.fillStyle = 'rgba(80,60,40,0.6)'; ctx.fillRect(-r * 0.9, -r * 1.15, r * 1.8, r * 0.2); }
    else { ctx.beginPath(); ctx.ellipse(0, -r * 0.85, r * 1.0, r * 0.95, 0, Math.PI, 0); ctx.fillStyle = grad('#1d1b19', 0.6, 1.5); ctx.fill(); }
  } else if (kind === 'cloche') {
    ctx.beginPath(); ctx.ellipse(0, -r * 0.55, r * 1.12, r * 1.1, 0, Math.PI, 0); ctx.lineTo(r * 1.3, -r * 0.35); ctx.quadraticCurveTo(0, -r * 0.2, -r * 1.3, -r * 0.35); ctx.closePath();
    ctx.fillStyle = grad(color || '#3a302a'); ctx.fill(); ctx.fillStyle = 'rgba(120,30,30,0.7)'; ctx.fillRect(-r * 1.1, -r * 0.75, r * 2.2, r * 0.16);
  } else if (kind === 'bonnet') {
    ctx.beginPath(); ctx.moveTo(-r * 1.2, r * 0.3); ctx.quadraticCurveTo(-r * 1.45, -r * 1.7, 0, -r * 1.65); ctx.quadraticCurveTo(r * 1.45, -r * 1.7, r * 1.2, r * 0.3);
    ctx.moveTo(r * 0.85, -r * 0.05); ctx.ellipse(0, -r * 0.05, r * 0.85, r * 1.05, 0, 0, Math.PI * 2, true);
    ctx.fillStyle = grad(color || '#e8e0cf', 0.8, 1.05); ctx.fill('evenodd');
    ctx.strokeStyle = '#7a2a2a'; ctx.lineWidth = r * 0.1; ctx.beginPath(); ctx.moveTo(-r * 0.8, r * 0.7); ctx.lineTo(0, r * 1.15); ctx.lineTo(r * 0.8, r * 0.7); ctx.stroke();
  } else if (kind === 'kova') {
    ctx.beginPath(); ctx.moveTo(-r * 1.45, -r * 0.45); ctx.quadraticCurveTo(-r * 1.0, -r * 0.85, -r * 0.75, -r * 0.95); ctx.quadraticCurveTo(-r * 0.25, -r * 2.05, 0, -r * 2.05); ctx.quadraticCurveTo(r * 0.25, -r * 2.05, r * 0.75, -r * 0.95); ctx.quadraticCurveTo(r * 1.0, -r * 0.85, r * 1.45, -r * 0.45); ctx.quadraticCurveTo(0, -r * 0.75, -r * 1.45, -r * 0.45);
    ctx.fillStyle = grad(color || '#c8b88a', 0.72, 1.1); ctx.fill();
    ctx.strokeStyle = 'rgba(60,50,30,0.35)'; ctx.lineWidth = Math.max(1, r * 0.04); ctx.beginPath(); ctx.moveTo(0, -r * 2.0); ctx.lineTo(0, -r * 0.95); ctx.stroke();
  } else if (kind === 'visor') {
    ctx.shadowColor = '#4ff5e6'; ctx.shadowBlur = r * 0.6;
    ctx.beginPath(); ctx.roundRect(-r * 1.05, -r * 0.42, r * 2.1, r * 0.4, r * 0.2); ctx.fillStyle = 'rgba(79,245,230,0.55)'; ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(-r * 0.8, -r * 0.38, r * 0.7, r * 0.06);
  }
  ctx.restore();
}

/**
 * Draw every person's costume. `people` are tracked people with `landmarks` (normalized),
 * `costume` (a variant from periods.js) and `id`; `light` is 0..1 scene brightness.
 */
export function drawCostumes(ctx, people, toScreen, light = 1) {
  for (const person of people) {
    const c = person.costume; if (!c) continue;
    const b = bodyGeometry(person.landmarks, toScreen); if (!b) continue;
    person.geometry = b;
    ctx.save(); ctx.globalAlpha = Math.min(1, person.fade ?? 1);
    if (c.garment && c.garment !== 'none') drawGarment(ctx, b, c, person.id);
    drawHeadwear(ctx, b, c.headwear, c.hatColor, person.id);
    ctx.restore();
  }
  // Match the costumes to the scene's light: darken painted pixels only.
  if (light < 0.98) {
    ctx.save(); ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(10,8,6,${(1 - light) * 0.75})`; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }
}
