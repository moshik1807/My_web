// App shell: camera, timeline, location, and turning the whole scene into another era.
import * as THREE from 'three';
import { LiveView } from './live.js';
import { LocationService, PRESETS } from './location.js';
import { ERAS, eraFor, profileFor, REGIONS } from './periods.js';
import { loadSettings, saveSettings, PROVIDERS, transformImage } from './ai.js';
import { YEAR_MIN, YEAR_MAX } from './config.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
let toastTimer = 0;
function toast(msg, ms = 4200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms); }
function haptic(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* unsupported */ } }
function status(msg) { const s = $('#status'); s.hidden = !msg; s.textContent = msg || ''; }
const store = {
  get(k, d) { try { const v = localStorage.getItem('vw:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vw:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = { year: clamp(store.get('year', 1920), YEAR_MIN, YEAR_MAX), lens: false, loop: false, busy: false, playing: false, lensGeom: { x: 0, y: 0, r: 0 } };
const server = { base: null, ai: false };

/* ---------------------------------------------------------------- renderer */
const canvas = $('#gl');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false }); }
catch (e) { $('#intro .card p').textContent = 'הדפדפן הזה לא תומך ב-WebGL, ולכן אי אפשר להציג את החלון לעבר.'; throw e; }
const dpr = Math.min(window.devicePixelRatio || 1, 2);
let W = 1, H = 1;
const live = new LiveView(renderer);
const loc = new LocationService();

function resize() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
  if (!state.lensGeom.r) state.lensGeom = { x: W / 2, y: H * 0.42, r: Math.min(W, H) * 0.28 };
  state.lensGeom.x = clamp(state.lensGeom.x, 0, W); state.lensGeom.y = clamp(state.lensGeom.y, 0, H);
  live.resize(W, H, dpr);
}
window.addEventListener('resize', resize);

async function detectServer() {
  const meta = document.querySelector('meta[name="vw-api"]');
  const base = new URLSearchParams(location.search).get('api') || (meta && meta.content);
  if (!base) return;
  try { const j = await (await fetch(`${base.replace(/\/$/, '')}/api/health`)).json(); if (j.ok) { server.base = base.replace(/\/$/, ''); server.ai = !!j.ai; } }
  catch { /* static hosting */ }
}

/* ---------------------------------------------------------------- era + place */
const profile = () => profileFor(loc.region, state.year);
function updateEra() {
  const p = profile();
  $('#yearText').textContent = state.year;
  $('#eraLabel').textContent = p.label; $('#eraBlurb').textContent = p.blurb;
  $('#eraSpan').textContent = `${p.era.start}–${Math.min(p.era.end, YEAR_MAX)}`;
  live.setGrade(p.grade);
  document.querySelectorAll('.klabel').forEach((el) => el.classList.toggle('active', +el.dataset.year === p.era.year));
  const now = p.era.key === 'now';
  $('#shutter').innerHTML = now ? 'בחרו<br>שנה' : (state.year < new Date().getFullYear() ? 'הפכו<br>לעבר' : 'הפכו<br>לעתיד');
}
function updatePlace() {
  const s = loc.status;
  $('#gpsDot').className = 'dot ' + (s === 'ok' ? 'ok' : s === 'locating' ? 'wait' : s === 'idle' ? '' : 'bad');
  $('#placeName').textContent = loc.place?.name || (s === 'locating' ? 'מאתר מיקום…' : s === 'denied' ? 'אין הרשאת מיקום' : loc.pos ? 'המיקום שלכם' : 'בחרו מקום');
  const acc = loc.pos?.source === 'gps' ? ` · ±${Math.round(loc.pos.accuracy)} מ׳` : loc.pos?.source === 'preset' ? ' · מקום לדוגמה' : '';
  $('#placeMeta').textContent = `${REGIONS[loc.region].label}${acc}`;
  updateEra();
}
loc.on(updatePlace);
loc.on(() => { if (loc.status === 'denied' && !state.deniedShown) { state.deniedShown = true; toast('אין גישה למיקום. לחצו על כרטיס המיקום כדי לבחור מקום.', 6000); } });

/* ---------------------------------------------------------------- timeline */
let lastDecade = Math.floor(state.year / 10), lastEra = eraFor(state.year).key;
function setYear(y, fromInput = false) {
  y = clamp(Math.round(y), YEAR_MIN, YEAR_MAX);
  const dec = Math.floor(y / 10); if (dec !== lastDecade) { haptic(6); lastDecade = dec; }
  const era = eraFor(y).key;
  if (era !== lastEra) { haptic(18); lastEra = era; dropResult(); }
  state.year = y; if (!fromInput) $('#year').value = y;
  updateEra(); store.set('year', y);
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

/* ---------------------------------------------------------------- camera */
const video = $('#cam');
async function startCamera() {
  $('#intro').hidden = true; $('#hudTop').hidden = false; $('#hudBottom').hidden = false;
  loc.startGPS();
  status('מבקש גישה למצלמה…');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    video.srcObject = stream; await video.play();
    live.setVideo(video); status('');
  } catch {
    status('אין גישה למצלמה. אשרו גישה למצלמה בהגדרות הדפדפן ורעננו את הדף.');
    return;
  }
  if (profile().era.key === 'now') toast('גררו את סרגל הזמן לשנה אחרת, ואז לחצו "הפכו לעבר".', 5000);
}
$('#startCamera').addEventListener('click', startCamera);

/* ---------------------------------------------------------------- AI: the whole scene in another era */
let abort = null, resultUrl = null;
function progress(msg, isErr = false) {
  const p = $('#progress'); p.hidden = !msg; p.className = 'progress' + (isErr ? ' err' : '');
  p.innerHTML = ''; if (!msg) return;
  if (!isErr) p.appendChild(document.createElement('i'));
  p.appendChild(document.createTextNode(msg));
}
function dropResult() {
  if (abort) abort.abort(); abort = null; state.busy = false; $('#shutter').disabled = false;
  live.clearResult(); $('#btnLive').hidden = true; $('#btnSave').hidden = true; progress('');
}
async function transformOnce() {
  if (!live.video) return toast('פתחו קודם את המצלמה.');
  const p = profile();
  if (!p.prompt) { toast('בחרו בסרגל שנה בעבר או בעתיד.'); return false; }
  const settings = loadSettings();
  state.busy = true; $('#shutter').disabled = true;
  const year = state.year, t0 = performance.now();
  const timer = setInterval(() => progress(`בונה את הסביבה כפי שנראתה ב-${year}… ${Math.round((performance.now() - t0) / 1000)} שנ׳`), 1000);
  progress(`בונה את הסביבה כפי שנראתה ב-${year}…`);
  abort = new AbortController(); const signal = abort.signal;
  try {
    const { url } = await transformImage({ dataUrl: live.capture(), year, place: loc.describe(), region: REGIONS[loc.region].en, profile: p, settings, serverBase: server.ai ? server.base : null, signal });
    if (signal.aborted) return false;
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; await img.decode();
    if (signal.aborted || year !== state.year && eraFor(year).key !== eraFor(state.year).key) return false;
    live.showResult(img); resultUrl = url;
    $('#btnLive').hidden = false; prepareSave(url, year);
    progress('');
    return true;
  } catch (e) {
    if (signal.aborted || e.name === 'AbortError') return false;
    progress(e.message === 'Failed to fetch' ? 'אין חיבור למנוע ה-AI. בדקו את החיבור לאינטרנט ונסו שוב.' : e.message, true);
    setLoop(false);
    return false;
  } finally { clearInterval(timer); state.busy = false; $('#shutter').disabled = false; }
}
async function prepareSave(url, year) {
  const a = $('#btnSave');
  try { const blob = await (await fetch(url)).blob(); if (a.href.startsWith('blob:')) URL.revokeObjectURL(a.href); a.href = URL.createObjectURL(blob); a.download = `vision-window-${year}.jpg`; a.hidden = false; }
  catch { a.hidden = true; }
}
$('#shutter').addEventListener('click', () => { if (!state.busy) transformOnce(); });
$('#btnLive').addEventListener('click', () => { setLoop(false); dropResult(); });

/* Continuous mode: as soon as one picture is ready, capture the current view and build the next. */
function setLoop(on) { state.loop = on; $('#btnLoop').setAttribute('aria-pressed', on); if (on) runLoop(); }
async function runLoop() {
  while (state.loop) {
    if (!state.busy) { const ok = await transformOnce(); if (!ok && state.loop && !profile().prompt) { setLoop(false); break; } }
    await new Promise((r) => setTimeout(r, 400));
  }
}
$('#btnLoop').addEventListener('click', () => {
  if (!state.loop && loadSettings().provider === 'free' && !server.ai) toast('מצב רציף עם המנוע החינמי ייגמר מהר מהמכסה היומית.', 5000);
  setLoop(!state.loop);
});

/* ---------------------------------------------------------------- lens */
function lensObj() { return { get on() { return state.lens; }, get x() { return state.lensGeom.x; }, get y() { return state.lensGeom.y; }, get r() { return state.lensGeom.r; } }; }
live.lens = lensObj();
$('#btnLens').addEventListener('click', () => { state.lens = !state.lens; $('#btnLens').setAttribute('aria-pressed', state.lens); if (state.lens && !live.showingResult) toast('העדשה מראה את ההווה בתוך התמונה מהעבר.'); });
const pointers = new Map(); let gesture = null, pinch0 = 0, r0 = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); r0 = state.lensGeom.r; gesture = 'pinch'; }
  else gesture = state.lens ? 'lens' : null;
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const p = pointers.get(e.pointerId), dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (gesture === 'pinch' && pointers.size === 2) { const [a, b] = [...pointers.values()]; state.lensGeom.r = clamp(r0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch0, 50, Math.max(W, H) * 0.75); }
  else if (gesture === 'lens') { state.lensGeom.x = clamp(state.lensGeom.x + dx, 0, W); state.lensGeom.y = clamp(state.lensGeom.y + dy, 0, H); }
});
const endPtr = (e) => { pointers.delete(e.pointerId); if (!pointers.size) gesture = null; };
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); state.lensGeom.r = clamp(state.lensGeom.r * Math.exp(-e.deltaY * 0.0012), 50, Math.max(W, H) * 0.75); }, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  if (e.code === 'BracketRight') { stopPlay(); setYear(state.year + 10); }
  if (e.code === 'BracketLeft') { stopPlay(); setYear(state.year - 10); }
  if (e.code === 'Escape') document.querySelectorAll('.sheet:not(#intro)').forEach((s) => { s.hidden = true; });
});

/* ---------------------------------------------------------------- sheets */
function openSheet(id) { const s = $(id); s.hidden = false; const f = s.querySelector('input, select, button'); if (f) f.focus(); }
document.querySelectorAll('.sheet').forEach((s) => {
  s.addEventListener('click', (e) => { if (e.target === s && s.id !== 'intro') s.hidden = true; });
  s.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { s.hidden = true; }));
});
function renderPlaceSheet() {
  const p = loc.place, pos = loc.pos, lines = [];
  if (p?.name) lines.push(p.name + (p.country ? `, ${p.country}` : ''));
  if (pos) lines.push(`${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}${pos.source === 'gps' ? ` (דיוק ±${Math.round(pos.accuracy)} מ׳)` : ''}`);
  lines.push(`האזור: ${REGIONS[loc.region].label}. לפיו נקבע איך נראתה הסביבה בכל תקופה.`);
  if (loc.status === 'denied') lines.push('הדפדפן חסם את הגישה למיקום. אפשר לאשר אותה בהגדרות האתר, או לבחור מקום לדוגמה.');
  $('#placeDetail').textContent = lines.join('\n'); $('#placeDetail').style.whiteSpace = 'pre-line';
  const ul = $('#nearby'); ul.textContent = '';
  if (loc.nearby.length) {
    const h = document.createElement('li'); const strong = document.createElement('strong'); strong.textContent = 'מקומות היסטוריים בסביבה'; h.appendChild(strong); ul.appendChild(h);
    for (const n of loc.nearby) {
      const li = document.createElement('li'); const a = document.createElement('a'); a.href = n.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = n.title;
      const d = document.createElement('span'); d.textContent = n.dist < 1000 ? `${n.dist} מ׳` : `${(n.dist / 1000).toFixed(1)} ק״מ`;
      li.append(a, d); ul.appendChild(li);
    }
  }
}
loc.on(() => { if (!$('#placeSheet').hidden) renderPlaceSheet(); });
$('#placeBtn').addEventListener('click', () => { renderPlaceSheet(); openSheet('#placeSheet'); });
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
  const id = $('#aiProvider').value, p = PROVIDERS[id];
  $('#aiKeyLabel').textContent = p.keyLabel; $('#aiModel').placeholder = p.model; $('#aiModel').parentElement.hidden = id === 'free';
  const note = $('#providerNote'); note.textContent = '';
  const text = id === 'free'
    ? 'המנוע החינמי רץ על שרת ציבורי של Hugging Face. כל תמונה לוקחת בערך 20–60 שניות, ויש מכסה יומית. טוקן חינמי מ-'
    : 'כל תמונה עולה כסף לפי התעריף של הספק. המפתח נשמר רק בדפדפן הזה. משיגים מפתח ב-';
  const a = document.createElement('a'); a.href = p.keyUrl; a.target = '_blank'; a.rel = 'noopener'; a.textContent = p.keyUrl.replace('https://', '');
  note.append(text, a, id === 'free' ? ' מגדיל את המכסה.' : '.');
}
$('#aiProvider').addEventListener('change', syncProvider);
$('#btnSettings').addEventListener('click', () => { fillSettings(); openSheet('#settingsSheet'); });
$('#settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  saveSettings({ provider: $('#aiProvider').value, key: $('#aiKey').value.trim(), model: $('#aiModel').value.trim() });
  $('#settingsSheet').hidden = true; toast('ההגדרות נשמרו בדפדפן הזה.');
});

/* ---------------------------------------------------------------- loop */
const clock = new THREE.Clock(); let time = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); time += dt;
  if (state.playing) { const y = playFrom + (performance.now() - playT0) / 1000 * 8; if (y >= YEAR_MAX) { setYear(YEAR_MAX); stopPlay(); } else setYear(y); }
  if (live.video) live.render(dt, time);
  requestAnimationFrame(frame);
}

buildTicks(); resize(); setYear(state.year); updatePlace();
detectServer();
requestAnimationFrame(frame);
window.__vw = { state, live, loc, setYear };
