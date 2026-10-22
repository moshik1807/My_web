// App shell: modes (live camera, photo, 3D reconstruction), timeline, location, dialogs.
import * as THREE from 'three';
import { ARView } from './ar.js';
import { LocationService, PRESETS } from './location.js';
import { ERAS, eraFor, profileFor, REGIONS } from './periods.js';
import { loadSettings, saveSettings, PROVIDERS, buildPrompt, captureFrame, transformImage } from './ai.js';
import { YEAR_MIN, YEAR_MAX } from './config.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let toastTimer = 0;
function toast(msg, ms = 4200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms); }
function haptic(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* unsupported */ } }
function status(msg) { const s = $('#status'); s.hidden = !msg; s.textContent = msg || ''; }
const store = {
  get(k, d) { try { const v = localStorage.getItem('vw:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vw:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/* ---------------------------------------------------------------- state */
const state = {
  mode: null, year: clamp(store.get('year', 1920), YEAR_MIN, YEAR_MAX), lens: false, playing: false, stats: false,
  arLayers: { people: true, transport: true, furniture: true, grade: true },
  layers3D: { buildings: true, people: true, vehicles: true, atmosphere: true },
  hour: 17.5, weather: 'clear',
  lensGeom: { x: 0, y: 0, r: 0 },
};
const server = { base: null, ai: false };

/* ---------------------------------------------------------------- renderer */
const canvas = $('#gl');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false }); }
catch (e) { $('#intro .card p').textContent = 'הדפדפן הזה לא תומך ב-WebGL, ולכן אי אפשר להציג את החלון לעבר.'; throw e; }
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const maxDpr = Math.min(window.devicePixelRatio || 1, 2);
let dpr = Math.min(maxDpr, 1.5);
let W = 1, H = 1;

const ar = new ARView(renderer);
let recon = null, reconData = null;
const loc = new LocationService();
let visionReady = null;

function resize() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
  if (!state.lensGeom.r) state.lensGeom = { x: W / 2, y: H * 0.45, r: Math.min(W, H) * 0.3 };
  state.lensGeom.x = clamp(state.lensGeom.x, 0, W); state.lensGeom.y = clamp(state.lensGeom.y, 0, H);
  ar.resize(W, H, dpr); if (recon) recon.resize(W, H, dpr);
  const dbg = $('#debug'); dbg.width = W; dbg.height = H;
  placeJoystick();
}
window.addEventListener('resize', resize);

/* ---------------------------------------------------------------- server (optional) */
async function detectServer() {
  const meta = document.querySelector('meta[name="vw-api"]');
  const params = new URLSearchParams(location.search);
  const base = params.get('api') || (meta && meta.content);
  if (!base) return;
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/health`); const j = await r.json();
    if (j.ok) { server.base = base.replace(/\/$/, ''); server.ai = !!j.ai; }
  } catch { /* no server: static hosting */ }
}

/* ---------------------------------------------------------------- era + place HUD */
function currentProfile() { return profileFor(loc.region, state.year); }
function updateEraCard() {
  $('#yearText').textContent = state.year;
  if (state.mode === 'model' && recon) {
    const e = recon.eraFor(state.year);
    $('#eraLabel').textContent = e.label; $('#eraBlurb').textContent = e.blurb;
    $('#eraSpan').textContent = `${e.year_start}–${Math.min(e.year_end, YEAR_MAX)}`;
  } else {
    const p = currentProfile();
    $('#eraLabel').textContent = p.label; $('#eraBlurb').textContent = p.blurb;
    $('#eraSpan').textContent = `${p.era.start}–${Math.min(p.era.end, YEAR_MAX)}`;
  }
  const key = eraFor(state.year).year;
  document.querySelectorAll('.klabel').forEach((el) => el.classList.toggle('active', +el.dataset.year === key));
}
function updatePlace() {
  const dot = $('#gpsDot');
  if (state.mode === 'model') {
    $('#placeName').textContent = reconData ? reconData.location.name : 'כיכר השעון, יפו';
    $('#placeMeta').textContent = 'שחזור תלת-ממדי'; dot.className = 'dot ok'; return;
  }
  const s = loc.status;
  dot.className = 'dot ' + (s === 'ok' ? 'ok' : s === 'locating' ? 'wait' : s === 'idle' ? '' : 'bad');
  $('#placeName').textContent = loc.place?.name || (s === 'locating' ? 'מאתר מיקום…' : s === 'denied' ? 'אין הרשאת מיקום' : loc.pos ? 'המיקום שלכם' : 'בחרו מקום');
  const acc = loc.pos && loc.pos.source === 'gps' ? ` · ±${Math.round(loc.pos.accuracy)} מ׳` : loc.pos?.source === 'preset' ? ' · מקום לדוגמה' : '';
  $('#placeMeta').textContent = `${REGIONS[loc.region].label}${acc}`;
  ar.setProfile(currentProfile()); updateEraCard();
}
loc.on(updatePlace);

/* ---------------------------------------------------------------- timeline */
let lastDecade = Math.floor(state.year / 10), lastEra = eraFor(state.year).key;
function setYear(y, fromInput = false) {
  y = clamp(Math.round(y), YEAR_MIN, YEAR_MAX);
  const dec = Math.floor(y / 10); if (dec !== lastDecade) { haptic(6); lastDecade = dec; }
  const era = eraFor(y).key; if (era !== lastEra) { haptic(18); lastEra = era; }
  state.year = y; if (!fromInput) $('#year').value = y;
  if (recon) recon.setYear(y);
  ar.setProfile(currentProfile());
  updateEraCard(); store.set('year', y);
}
function buildTicks() {
  const wrap = $('#ticks'); wrap.textContent = '';
  const pct = (y) => ((y - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100, now = new Date().getFullYear();
  for (let y = YEAR_MIN; y <= YEAR_MAX; y += 10) { const t = document.createElement('i'); t.className = 'tick'; t.style.left = pct(y) + '%'; wrap.appendChild(t); }
  for (const e of ERAS) {
    const isNow = e.key === 'now';
    const t = document.createElement('i'); t.className = 'tick key' + (isNow ? ' now' : ''); t.style.left = pct(e.year) + '%'; wrap.appendChild(t);
    const b = document.createElement('button'); b.className = 'klabel' + (isNow ? ' now' : ''); b.dataset.year = e.year; b.style.left = pct(e.year) + '%';
    b.textContent = isNow ? now : e.year;
    if (isNow) { const s = document.createElement('span'); s.className = 'today'; s.textContent = ' · היום'; b.appendChild(s); }
    b.addEventListener('click', () => { stopPlay(); setYear(isNow ? now : e.year); });
    wrap.appendChild(b);
  }
}
$('#year').addEventListener('input', (e) => { stopPlay(); setYear(+e.target.value, true); });
let playFrom = 0, playT0 = 0;
function stopPlay() { state.playing = false; $('#playIcon').setAttribute('d', 'M2 1l7 4-7 4z'); }
$('#play').addEventListener('click', () => {
  if (state.playing) return stopPlay();
  state.playing = true; playFrom = state.year >= YEAR_MAX ? YEAR_MIN : state.year; playT0 = performance.now();
  $('#playIcon').setAttribute('d', 'M2 1h2.2v8H2zM5.8 1H8v8H5.8z');
});

/* ---------------------------------------------------------------- modes */
const video = $('#cam');
let stream = null;
function showHUD() { $('#intro').hidden = true; $('#hudTop').hidden = false; $('#hudBottom').hidden = false; }
function setModeUI(mode) {
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === mode));
  const is3D = mode === 'model';
  $('#layersAR').hidden = is3D; $('#layers3D').hidden = !is3D; $('#hourGroup').hidden = !is3D; $('#weatherGroup').hidden = !is3D;
  $('#shutterRow').hidden = is3D; $('#seen').hidden = is3D; $('#joy').hidden = !(is3D && isTouch);
  if (is3D && !state.lensTouched) setLens(true); else if (!is3D && !state.lensTouched) setLens(false);
  updatePlace(); updateEraCard(); placeJoystick();
}
function stopCamera() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; video.srcObject = null; }

async function ensureVision() {
  if (!visionReady) {
    visionReady = ar.init((msg) => status(msg)).then(() => status(''), (e) => { status(''); visionReady = null; throw e; });
  }
  return visionReady;
}

async function enterCamera() {
  showHUD(); setModeUI('camera');
  if (!loc.pos || loc.pos.source !== 'preset') loc.startGPS();
  status('מבקש גישה למצלמה…');
  try {
    stopCamera();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream; await video.play();
  } catch (e) {
    status('');
    toast('אין גישה למצלמה. אשרו גישה בהגדרות הדפדפן, או העלו תמונה של רחוב.', 6000);
    return enterPhoto();
  }
  try { await ensureVision(); }
  catch (e) { toast('טעינת מודלי הראייה נכשלה. בדקו את החיבור לאינטרנט ורעננו את הדף.', 6000); }
  await ar.setSource({ el: video, w: video.videoWidth || 1280, h: video.videoHeight || 720, kind: 'camera' });
  ar.setProfile(currentProfile());
  if (state.year >= 1998 && state.year <= 2037) toast('גררו את סרגל הזמן לשנה אחרת כדי לראות את המקום בעבר.');
}

function enterPhoto() { $('#photoInput').value = ''; $('#photoInput').click(); }
$('#photoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  showHUD(); stopCamera(); setModeUI('photo');
  const img = new Image(); img.src = URL.createObjectURL(file);
  try { await img.decode(); } catch { toast('לא הצלחנו לפתוח את התמונה. נסו קובץ JPG או PNG.'); return; }
  const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src);
  if (!loc.pos) { loc.usePreset('jaffa'); toast('המקום נקבע ליפו. לחצו על כרטיס המיקום כדי לבחור מקום אחר או להשתמש ב-GPS.', 5500); }
  try { await ensureVision(); } catch { toast('טעינת מודלי הראייה נכשלה. בדקו את החיבור לאינטרנט ורעננו את הדף.', 6000); }
  await ar.setSource({ el: c, w: c.width, h: c.height, kind: 'photo' });
  ar.setProfile(currentProfile());
});

async function loadTimeline() {
  if (server.base) {
    try {
      const near = await (await fetch(`${server.base}/api/locations/nearby?lat=32.05497&lng=34.75633&radius=500`)).json();
      const tl = await (await fetch(`${server.base}/api/locations/${near.locations[0].id}/timeline`)).json();
      tl.source = 'api'; return tl;
    } catch { /* fall back to the bundled dataset */ }
  }
  const tl = await (await fetch('data/jaffa-demo.json')).json(); tl.source = 'demo'; return tl;
}
async function enterModel() {
  showHUD(); stopCamera(); setModeUI('model');
  if (!recon) {
    status('בונה את כיכר השעון…');
    try {
      reconData = await loadTimeline();
      const { Reconstruction } = await import('./scene3d.js');
      recon = new Reconstruction(renderer, reconData, { shadows: !isTouch });
      recon.resize(W, H, dpr); recon.setHour(state.hour); recon.setLayers(state.layers3D);
      recon.getWorld(recon.presentEra()); recon.setYear(state.year); recon.warmUp();
    } catch (e) { status(''); toast('טעינת השחזור נכשלה. רעננו את הדף ונסו שוב.'); return; }
    status('');
    toast(isTouch ? 'גררו כדי להסתכל, והג׳ויסטיק מזיז אתכם בכיכר.' : 'גררו כדי להסתכל. WASD להליכה, גלגלת לשינוי גודל העדשה.', 5000);
  }
  recon.lens = lensObj(); updatePlace(); updateEraCard();
}

$('#startCamera').addEventListener('click', enterCamera);
$('#startPhoto').addEventListener('click', enterPhoto);
$('#startModel').addEventListener('click', enterModel);
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  const m = b.dataset.mode; if (m === 'camera') enterCamera(); else if (m === 'photo') enterPhoto(); else enterModel();
}));

/* ---------------------------------------------------------------- controls */
function lensObj() { return { on: state.lens, get x() { return state.lensGeom.x; }, get y() { return state.lensGeom.y; }, get r() { return state.lensGeom.r; } }; }
function setLens(on) { state.lens = on; $('#btnLens').setAttribute('aria-pressed', on); ar.lens = lensObj(); if (recon) recon.lens = lensObj(); }
$('#btnLens').addEventListener('click', () => { state.lensTouched = true; setLens(!state.lens); });
document.querySelectorAll('[data-ar-layer]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.arLayer; state.arLayers[k] = !state.arLayers[k]; b.setAttribute('aria-pressed', state.arLayers[k]); ar.setLayers(state.arLayers);
}));
document.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.layer; state.layers3D[k] = !state.layers3D[k]; b.setAttribute('aria-pressed', state.layers3D[k]); if (recon) recon.setLayers(state.layers3D);
}));
const fmtHour = (h) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
$('#hour').addEventListener('input', (e) => { state.hour = +e.target.value; $('#hourOut').textContent = fmtHour(state.hour); if (recon) recon.setHour(state.hour); });
document.querySelectorAll('[data-weather]').forEach((b) => b.addEventListener('click', () => {
  state.weather = b.dataset.weather; document.querySelectorAll('[data-weather]').forEach((o) => o.setAttribute('aria-pressed', o === b)); if (recon) recon.setWeather(state.weather);
}));
$('#btnStats').addEventListener('click', () => { state.stats = !state.stats; $('#stats').hidden = !state.stats; $('#debug').hidden = !state.stats; $('#btnStats').setAttribute('aria-pressed', state.stats); });

/* Pointer: drag the lens, pinch or wheel to resize it; in 3D, drag elsewhere to look around. */
const pointers = new Map(); let gesture = null, pinch0 = 0, r0 = 0;
const onLens = (x, y) => state.lens && Math.hypot(x - state.lensGeom.x, y - state.lensGeom.y) < state.lensGeom.r;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && state.lens) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); r0 = state.lensGeom.r; gesture = 'pinch'; }
  else gesture = onLens(e.clientX, e.clientY) ? 'lens' : 'look';
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) { canvas.classList.toggle('on-lens', onLens(e.clientX, e.clientY)); return; }
  const p = pointers.get(e.pointerId), dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (gesture === 'pinch' && pointers.size === 2) { const [a, b] = [...pointers.values()]; state.lensGeom.r = clamp(r0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch0, 60, Math.max(W, H) * 0.75); }
  else if (gesture === 'lens') { state.lensGeom.x = clamp(state.lensGeom.x + dx, 0, W); state.lensGeom.y = clamp(state.lensGeom.y + dy, 0, H); }
  else if (gesture === 'look' && state.mode === 'model' && recon) recon.look(dx, dy);
});
const endPtr = (e) => { pointers.delete(e.pointerId); if (!pointers.size) { gesture = null; canvas.classList.remove('dragging'); } else if (gesture === 'pinch') gesture = 'look'; };
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (state.lens) state.lensGeom.r = clamp(state.lensGeom.r * Math.exp(-e.deltaY * 0.0012), 60, Math.max(W, H) * 0.75); }, { passive: false });

const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  keys.add(e.code);
  if (e.code === 'KeyL') { state.lensTouched = true; setLens(!state.lens); }
  if (e.code === 'BracketRight') { stopPlay(); setYear(state.year + 10); }
  if (e.code === 'BracketLeft') { stopPlay(); setYear(state.year - 10); }
  if (e.code === 'Escape') document.querySelectorAll('.sheet:not(#intro)').forEach((s) => { s.hidden = true; });
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

const joy = { x: 0, y: 0, id: null };
function placeJoystick() { const el = $('#joy'); if (el.hidden) return; el.style.top = ($('#hudBottom').getBoundingClientRect().top - 122) + 'px'; }
(() => {
  const el = $('#joy'), knob = el.querySelector('i');
  const move = (e) => {
    const r = el.getBoundingClientRect(); let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    joy.x = x; joy.y = y; knob.style.transform = `translate(${x * 32}px, ${y * 32}px)`;
  };
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); joy.id = e.pointerId; move(e); });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === joy.id) move(e); });
  const end = () => { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
})();

/* ---------------------------------------------------------------- sheets */
function openSheet(id) { const s = $(id); s.hidden = false; const f = s.querySelector('input, select, button, a'); if (f) f.focus(); }
document.querySelectorAll('.sheet').forEach((s) => {
  s.addEventListener('click', (e) => { if (e.target === s && s.id !== 'intro') s.hidden = true; });
  s.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { s.hidden = true; }));
});

function renderPlaceSheet() {
  const p = loc.place, pos = loc.pos;
  const lines = [];
  if (p?.name) lines.push(p.name + (p.country ? `, ${p.country}` : ''));
  if (pos) lines.push(`${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}${pos.source === 'gps' ? ` (דיוק ±${Math.round(pos.accuracy)} מ׳)` : ''}`);
  lines.push(`האזור: ${REGIONS[loc.region].label}. לפיו נקבעים הבגדים, כלי התחבורה והריהוט של כל תקופה.`);
  if (loc.status === 'denied') lines.push('הדפדפן חסם את הגישה למיקום. אפשר לאשר אותה בהגדרות האתר, או לבחור מקום לדוגמה.');
  $('#placeDetail').textContent = lines.join('\n'); $('#placeDetail').style.whiteSpace = 'pre-line';
  const ul = $('#nearby'); ul.textContent = '';
  if (loc.nearby.length) {
    const h = document.createElement('li'); h.innerHTML = '<strong>מקומות היסטוריים בסביבה</strong>'; ul.appendChild(h);
    for (const n of loc.nearby) {
      const li = document.createElement('li'); const a = document.createElement('a'); a.href = n.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = n.title;
      const d = document.createElement('span'); d.textContent = n.dist < 1000 ? `${n.dist} מ׳` : `${(n.dist / 1000).toFixed(1)} ק״מ`;
      li.append(a, d); ul.appendChild(li);
    }
  }
}
loc.on(() => { if (!$('#placeSheet').hidden) renderPlaceSheet(); });
$('#placeBtn').addEventListener('click', () => { if (state.mode === 'model') return; renderPlaceSheet(); openSheet('#placeSheet'); });
$('#useGPS').addEventListener('click', () => { loc.startGPS(); $('#placeSheet').hidden = true; });
for (const p of PRESETS) {
  const b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.textContent = p.name;
  b.addEventListener('click', () => { loc.usePreset(p.id); $('#placeSheet').hidden = true; });
  $('#presets').appendChild(b);
}

function fillSettings() {
  const s = loadSettings();
  $('#aiProvider').value = s.provider; $('#aiKey').value = s.key; $('#aiModel').value = s.model;
  syncProvider(); $('#serverNote').hidden = !server.ai;
}
function syncProvider() {
  const p = PROVIDERS[$('#aiProvider').value];
  $('#aiModel').placeholder = p.model; $('#keyLink').href = p.keyUrl; $('#keyLink').textContent = p.keyUrl.replace('https://', '');
}
$('#aiProvider').addEventListener('change', syncProvider);
$('#btnSettings').addEventListener('click', () => { fillSettings(); openSheet('#settingsSheet'); });
$('#settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  saveSettings({ provider: $('#aiProvider').value, key: $('#aiKey').value.trim(), model: $('#aiModel').value.trim() });
  $('#settingsSheet').hidden = true; toast('ההגדרות נשמרו בדפדפן הזה.');
});

/* AI snapshot */
let aiAbort = null;
$('#shutter').addEventListener('click', async () => {
  if (!ar.source) return toast('פתחו את המצלמה או העלו תמונה קודם.');
  const profile = currentProfile();
  if (!profile.prompt) return toast('בחרו בסרגל שנה בעבר או בעתיד, ואז צלמו.');
  const settings = loadSettings();
  if (!server.ai && !settings.key) { fillSettings(); openSheet('#settingsSheet'); toast('כדי ליצור תמונה מציאותית צריך מפתח API.'); return; }
  const src = ar.source;
  const before = captureFrame(src.el, src.w, src.h);
  const prompt = buildPrompt({ year: state.year, place: loc.describe(), region: REGIONS[loc.region].en, profile, facts: ar.sceneFacts() });
  $('#resultTitle').textContent = `צילום מ-${state.year}`;
  $('#resultPrompt').textContent = prompt; $('#resultSave').hidden = true;
  const body = $('#resultBody'); body.innerHTML = `<div class="spinner"><i></i>יוצר את הצילום מ-${state.year}. זה לוקח בדרך כלל 10–30 שניות.</div>`;
  openSheet('#resultSheet');
  if (aiAbort) aiAbort.abort(); aiAbort = new AbortController();
  try {
    const after = await transformImage({ dataUrl: before, prompt, settings, serverBase: server.ai ? server.base : null, signal: aiAbort.signal });
    showCompare(body, before, after);
    const save = $('#resultSave'); save.href = after; save.download = `vision-window-${state.year}.png`; save.hidden = false;
  } catch (e) {
    if (e.name === 'AbortError') return;
    body.innerHTML = ''; const p = document.createElement('p'); p.className = 'err';
    p.textContent = e.message === 'Failed to fetch' ? 'אין חיבור לספק ה-AI. בדקו את החיבור לאינטרנט ונסו שוב.' : e.message; body.appendChild(p);
  }
});
$('#resultSheet').querySelector('[data-close]').addEventListener('click', () => { if (aiAbort) aiAbort.abort(); });
function showCompare(body, before, after) {
  body.innerHTML = `<div class="compare" id="cmp"><img alt="היום" src="${before}"><div class="after"><img alt="בעבר" src="${after}"></div><i class="handle"></i><span class="tag now">היום</span><span class="tag then">${state.year}</span></div>`;
  const cmp = body.querySelector('#cmp'), after_ = cmp.querySelector('.after'), handle = cmp.querySelector('.handle');
  const set = (x) => { const r = cmp.getBoundingClientRect(); const t = clamp((x - r.left) / r.width, 0, 1); after_.style.clipPath = `inset(0 0 0 ${t * 100}%)`; handle.style.left = `${t * 100}%`; };
  let drag = false;
  cmp.addEventListener('pointerdown', (e) => { drag = true; cmp.setPointerCapture(e.pointerId); set(e.clientX); });
  cmp.addEventListener('pointermove', (e) => { if (drag) set(e.clientX); });
  cmp.addEventListener('pointerup', () => { drag = false; });
}

/* ---------------------------------------------------------------- HUD refresh */
function refreshSeen() {
  if (state.mode !== 'camera' && state.mode !== 'photo') return;
  const ul = $('#seenList'); const lines = ar.describe();
  ul.textContent = '';
  if (!ar.vision.ready) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'טוען מודלי ראייה…'; ul.appendChild(li); return; }
  if (!ar.transforming) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'בחרו שנה כדי להתחיל'; ul.appendChild(li); return; }
  if (!lines.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'כוונו אל אנשים, כלי רכב או ספסלים'; ul.appendChild(li); return; }
  for (const l of lines.slice(0, 6)) { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); }
}
function refreshStats(perf) {
  if (!state.stats) return;
  const rows = [['FPS', perf.fps.toFixed(0)], ['frame', perf.ms.toFixed(1) + ' ms'], ['pixel ratio', dpr.toFixed(2)]];
  if (state.mode === 'model' && recon) {
    const s = recon.stats();
    rows.push(['LOD 0/1/2', s.lod.join(' / ')], ['entities', `${s.peds} ppl · ${s.vehicles} veh`], ['data', reconData.source === 'api' ? 'PostGIS API' : 'bundled demo'], ['pos ENU', `${s.pos.x.toFixed(1)}, ${s.pos.z.toFixed(1)}`]);
  } else {
    rows.push(['vision', ar.visionMs.toFixed(1) + ' ms'], ['people', ar.people.tracks.length], ['objects', ar.objects.tracks.length], ['props', ar.props.size], ['region', loc.region]);
    if (loc.pos) rows.push(['lat/lng', `${loc.pos.lat.toFixed(5)}, ${loc.pos.lng.toFixed(5)}`]);
  }
  const dl = $('#statsList'); dl.textContent = '';
  for (const [k, v] of rows) { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); }
}
function drawDebug() {
  const c = $('#debug'); if (c.hidden) return; const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  if (state.mode === 'model' || !ar.source) return;
  g.lineWidth = 1.5; g.font = '11px "IBM Plex Mono", monospace';
  for (const [list, color] of [[ar.objects.tracks, '#7fd8d0'], [ar.people.tracks, '#f0c788']]) {
    for (const t of list) {
      const b = ar.boxToScreen(t.box); g.strokeStyle = color; g.globalAlpha = t.missed ? 0.4 : 1; g.strokeRect(b.x, b.y, b.w, b.h);
      g.fillStyle = color; g.fillText(`${t.label} #${t.id}`, b.x + 3, b.y + 12);
    }
  }
  g.globalAlpha = 1;
}

/* ---------------------------------------------------------------- loop */
const clock = new THREE.Clock(); let time = 0;
const perf = { frames: 0, acc: 0, fps: 60, ms: 16, low: 0, high: 0 }; let lastNow = performance.now(), lastHud = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); time += dt;
  if (state.playing) { const y = playFrom + (performance.now() - playT0) / 1000 * 8; if (y >= YEAR_MAX) { setYear(YEAR_MAX); stopPlay(); } else setYear(y); }
  if (state.mode === 'model' && recon) {
    let mx = joy.x, mz = -joy.y;
    if (keys.has('KeyW') || keys.has('ArrowUp')) mz += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) mz -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    recon.move = { x: mx, z: mz, run: keys.has('ShiftLeft') || keys.has('ShiftRight') };
    recon.render(dt, time, reducedMotion);
  } else if (state.mode && ar.active) {
    ar.render(dt, time);
  } else {
    renderer.setRenderTarget(null); renderer.setClearColor(0x0d0c0b, 1); renderer.clear();
  }
  const now = performance.now(); perf.frames++; perf.acc += (now - lastNow) / 1000; lastNow = now;
  if (perf.acc >= 0.5) {
    perf.fps = perf.frames / perf.acc; perf.ms = perf.acc / perf.frames * 1000; perf.frames = 0; perf.acc = 0;
    if (perf.fps < 40) perf.low++; else perf.low = 0; if (perf.fps > 57) perf.high++; else perf.high = 0;
    if (perf.low >= 3 && dpr > 0.75) { dpr = Math.max(0.75, dpr - 0.15); perf.low = 0; resize(); }
    if (perf.high >= 8 && dpr < maxDpr) { dpr = Math.min(maxDpr, dpr + 0.1); perf.high = 0; resize(); }
    refreshStats(perf);
  }
  if (now - lastHud > 400) { lastHud = now; refreshSeen(); }
  drawDebug();
  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------------- boot */
buildTicks(); resize(); setYear(state.year); setLens(false); ar.setLayers(state.arLayers);
detectServer();
requestAnimationFrame(frame);
const startMode = new URLSearchParams(location.search).get('mode');
if (startMode === 'model') enterModel();
window.__vw = { state, ar, loc, setYear, get recon() { return recon; }, perf };
