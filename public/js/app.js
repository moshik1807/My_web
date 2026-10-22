import { Clock } from './clock.js';
import { SyncPlayer } from './player.js';

const $app = document.getElementById('app');
const $conn = document.getElementById('conn');
const $toast = document.getElementById('toast');

const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

let ws = null;
let connected = false;
let retryMs = 500;
let session = store.get('session'); // { code, token }
let state = null;
let notice = null; // message shown on the home screen after leaving a room
let renderedKey = '';
let pendingRender = false;

const clock = new Clock((msg) => send(msg));
const player = new SyncPlayer(clock);
player.setCalibration(store.get('calibrationMs', 0));
player.onChange = () => {
  report();
  render();
};

// Handy for checking sync from the devtools console.
window.partySpeaker = { clock, player };

const inviteCode = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';

// ---------- networking ----------

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.addEventListener('open', () => {
    connected = true;
    retryMs = 500;
    clock.reset();
    clock.start();
    if (session?.code) send({ type: 'join', code: session.code, token: session.token, name: store.get('name', '') });
    render();
  });
  ws.addEventListener('message', (e) => onMessage(JSON.parse(e.data)));
  ws.addEventListener('close', () => {
    connected = false;
    clock.stop();
    render();
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 8000);
  });
}

function onMessage(msg) {
  switch (msg.type) {
    case 'pong':
      clock.onPong(msg);
      return;
    case 'session':
      session = { code: msg.code, token: msg.token };
      store.set('session', session);
      history.replaceState(null, '', `?room=${msg.code}`);
      return;
    case 'state':
      onState(msg.state);
      return;
    case 'error':
      if (msg.code === 'no_room' && session) {
        leaveLocally('החדר נסגר או לא קיים.');
      } else {
        toast(msg.message);
      }
      return;
    case 'rejected':
      leaveLocally('בעל החדר דחה את הבקשה להצטרף.');
      return;
    case 'kicked':
      leaveLocally('הוצאתם מהחדר.');
      return;
    case 'closed':
      leaveLocally(msg.reason === 'idle' ? 'החדר נסגר כי בעל החדר לא חזר.' : 'בעל החדר סגר את החדר.');
      return;
    case 'replaced':
      leaveLocally('החדר נפתח בחלון אחר.', { keepSession: true });
      return;
  }
}

function onState(next) {
  state = next;
  if (state.status === 'approved') {
    player.setVolume(state.volume);
    player.apply(state.playback);
    preload();
  }
  render();
}

function leaveLocally(message, { keepSession = false } = {}) {
  if (!keepSession) {
    session = null;
    store.set('session', null);
    history.replaceState(null, '', location.pathname);
  }
  state = null;
  notice = message;
  player.apply(null);
  releaseWakeLock();
  render();
}

function trackUrl(id) {
  return `/api/rooms/${session.code}/tracks/${id}?token=${encodeURIComponent(session.token)}`;
}

// Load the current track and the one after it, so the next song starts in
// sync without a gap for downloading.
function preload() {
  const ids = state.tracks.map((t) => t.id);
  const current = state.playback.trackId ?? ids[0];
  const idx = ids.indexOf(current);
  for (const id of [current, ids[idx + 1]]) {
    if (id && !player.isReady(id)) player.load(id, trackUrl(id)).catch(() => toast('הורדת השיר נכשלה'));
  }
  player.forget(new Set(ids));
}

function report() {
  if (state?.status !== 'approved') return;
  const id = state.playback.trackId ?? state.tracks[0]?.id ?? null;
  send({
    type: 'report',
    latencyMs: player.unlocked ? player.outputLatency() * 1000 : null,
    readyTrackId: player.unlocked && id && player.isReady(id) ? id : null,
  });
}
setInterval(report, 4000);

// ---------- screen wake lock ----------

let wakeLock = null;
async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {}
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && player.unlocked && state) requestWakeLock();
});

// ---------- helpers ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let toastTimer;
function toast(text) {
  $toast.textContent = text;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.hidden = true), 3500);
}

function audioDuration(file) {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const done = (d) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) ? d : 0);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}

async function uploadFiles(files) {
  for (const file of files) {
    toast(`מעלה את ${file.name}…`);
    const duration = await audioDuration(file);
    try {
      const res = await fetch(`/api/rooms/${session.code}/tracks`, {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-token': session.token,
          'x-track-name': encodeURIComponent(file.name.replace(/\.[^.]+$/, '')),
          'x-track-duration': String(duration),
        },
        body: file,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `שגיאה ${res.status}`);
    } catch (err) {
      toast(`ההעלאה של ${file.name} נכשלה: ${err.message}`);
      return;
    }
  }
  toast('השירים נוספו לרשימה');
}

function joinLink() {
  return `${location.origin}${location.pathname}?room=${state.code}`;
}

async function shareLink() {
  const url = joinLink();
  const text = `הצטרפו לרמקול של ${state.name} – קוד ${state.code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Party Speaker', text, url });
      return;
    } catch {}
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('הקישור הועתק');
  } catch {
    prompt('העתיקו את הקישור:', url);
  }
}

function currentTrack() {
  return state?.tracks?.find((t) => t.id === state.playback.trackId) ?? null;
}

// ---------- rendering ----------

function screenName() {
  if (!session) return 'home';
  if (!state) return 'loading';
  if (state.status === 'pending') return 'waiting';
  return state.role === 'host' ? 'host' : 'guest';
}

function render() {
  $conn.className = `conn ${connected ? 'on' : 'off'}`;
  $conn.textContent = connected ? (clock.synced ? 'מסונכרן' : 'מסתנכרן…') : 'מתחבר…';

  // Don't rebuild the page under a finger that is dragging a slider.
  if (document.activeElement?.matches?.('input[type=range]') && $app.contains(document.activeElement)) {
    pendingRender = true;
    return;
  }
  pendingRender = false;

  const screen = screenName();
  const html = SCREENS[screen]();
  // Skip identical rebuilds so text inputs keep focus and caret.
  const key = `${screen}|${html}`;
  if (key === renderedKey) return;
  const hadFocus = screen === 'home' && document.activeElement?.id;
  renderedKey = key;
  $app.innerHTML = html;
  if (hadFocus) document.getElementById(hadFocus)?.focus();
  updateProgress();
}

document.addEventListener('change', () => pendingRender && render(), true);
document.addEventListener('pointerup', () => setTimeout(() => pendingRender && render(), 50), true);

const SCREENS = {
  home() {
    const name = esc(store.get('name', ''));
    return `
      <section class="hero">
        <h1>הופכים את כל הטלפונים לרמקול אחד</h1>
        <p>פותחים חדר, כולם מצטרפים עם הקוד, ובעל החדר מנגן מוזיקה בכל הטלפונים בבת אחת. בלי רמקולים ובלי הגברה.</p>
      </section>
      ${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
      <div class="card">
        <label class="field">השם שלכם
          <input id="name" maxlength="40" autocomplete="nickname" placeholder="למשל: דנה" value="${name}">
        </label>
      </div>
      <div class="card">
        <h2>הצטרפות לחדר</h2>
        <form id="join-form" class="row">
          <input id="code" class="code-input" maxlength="5" autocapitalize="characters" autocomplete="off"
                 placeholder="קוד חדר" value="${esc(inviteCode)}" dir="ltr">
          <button class="btn primary" type="submit">הצטרפות</button>
        </form>
      </div>
      <div class="card">
        <h2>פתיחת חדר חדש</h2>
        <form id="create-form">
          <label class="field">שם החדר
            <input id="room-name" maxlength="40" placeholder="למשל: החתונה של נועה ואיתי">
          </label>
          <label class="check">
            <input id="private" type="checkbox">
            <span>חדר פרטי: רק מי שאישרתי יכול להצטרף</span>
          </label>
          <button class="btn primary wide" type="submit">פתיחת חדר</button>
        </form>
      </div>`;
  },

  loading() {
    return `<div class="center"><div class="spinner"></div><p>מתחבר לחדר…</p></div>`;
  },

  waiting() {
    return `
      <div class="center">
        <div class="pulse">⏳</div>
        <h2>מחכים לאישור</h2>
        <p>${esc(state.name)} הוא חדר פרטי. ${esc(state.hostName)} צריך לאשר אתכם.</p>
        <button class="btn ghost" data-action="leave">ביטול</button>
      </div>`;
  },

  guest() {
    const track = currentTrack();
    const pb = state.playback;
    const ready = track && player.isReady(track.id);
    const cal = store.get('calibrationMs', 0);
    const syncText = clock.rtt == null ? '…' : `±${Math.round(clock.rtt / 2)}ms`;
    return `
      <section class="room-head">
        <div class="room-name">${esc(state.name)}</div>
        <div class="muted">מארח: ${esc(state.hostName)}${state.hostOnline ? '' : ' (לא מחובר)'} · ${state.speakers} רמקולים</div>
      </section>
      ${
        player.unlocked
          ? `<div class="speaker on ${pb.status === 'playing' ? 'playing' : ''}">
               <div class="speaker-cone"></div>
             </div>
             <div class="now">
               <div class="track-name">${track ? esc(track.name) : 'ממתינים לשיר מבעל החדר'}</div>
               ${track ? `<div class="progress"><div class="bar" data-progress></div></div>
                 <div class="times"><span data-pos>0:00</span><span>${fmtTime(track.duration)}</span></div>` : ''}
               ${track && !ready ? '<div class="muted">מוריד את השיר…</div>' : ''}
             </div>
             <div class="stats">
               <div><b>${Math.round(state.volume * 100)}%</b><span>עוצמה (בשליטת המארח)</span></div>
               <div><b>${syncText}</b><span>דיוק סנכרון</span></div>
             </div>
             <p class="tip">הגבירו את הווליום של הטלפון למקסימום והשאירו את המסך פתוח.</p>
             <details class="card">
               <summary>כיול השהיה</summary>
               <p class="muted">אם הטלפון הזה נשמע מאחר או מקדים לעומת האחרים, הזיזו את הסליידר.</p>
               <input type="range" id="calibration" min="-300" max="300" step="5" value="${cal}">
               <div class="muted">${cal > 0 ? `מקדים ב-${cal}ms` : cal < 0 ? `מאחר ב-${-cal}ms` : 'ללא תיקון'}</div>
             </details>`
          : `<button class="speaker" data-action="unlock">
               <div class="speaker-cone"></div>
               <span>הקישו כדי להפוך לרמקול</span>
             </button>`
      }
      <button class="btn ghost wide" data-action="leave">יציאה מהחדר</button>`;
  },

  host() {
    const track = currentTrack();
    const pb = state.playback;
    const playing = pb.status === 'playing';
    const online = state.members.filter((m) => m.connected);
    const readyCount = track
      ? online.filter((m) => m.readyTrackId === track.id).length
      : 0;
    return `
      <section class="room-head">
        <div class="room-name">${esc(state.name)}</div>
        <div class="code-box">
          <span class="muted">קוד החדר</span>
          <b dir="ltr">${esc(state.code)}</b>
          <button class="btn small" data-action="share">שיתוף קישור</button>
        </div>
        <label class="check">
          <input type="checkbox" data-action="private" ${state.isPrivate ? 'checked' : ''}>
          <span>חדר פרטי (אישור ידני לכל מצטרף)</span>
        </label>
      </section>

      ${
        state.pending.length
          ? `<div class="card attention">
               <h2>מבקשים להצטרף (${state.pending.length})</h2>
               ${state.pending
                 .map(
                   (m) => `<div class="member">
                     <span class="name">${esc(m.name)}</span>
                     <button class="btn small primary" data-action="approve" data-id="${m.id}">אישור</button>
                     <button class="btn small ghost" data-action="reject" data-id="${m.id}">דחייה</button>
                   </div>`,
                 )
                 .join('')}
             </div>`
          : ''
      }

      <div class="card">
        <h2>מתנגן עכשיו</h2>
        <div class="track-name">${track ? esc(track.name) : 'שום דבר'}</div>
        ${
          track
            ? `<input type="range" id="seek" min="0" max="${Math.max(1, Math.floor(track.duration))}" step="1" value="0">
               <div class="times"><span data-pos>0:00</span><span>${fmtTime(track.duration)}</span></div>
               <div class="muted">${readyCount}/${online.length} רמקולים טענו את השיר</div>`
            : ''
        }
        <div class="controls">
          <button class="btn round" data-action="stop" ${pb.status === 'stopped' ? 'disabled' : ''} title="עצירה">⏹</button>
          <button class="btn round big primary" data-action="${playing ? 'pause' : 'play'}" ${state.tracks.length ? '' : 'disabled'}>${playing ? '⏸' : '▶'}</button>
          <button class="btn round" data-action="next" ${track ? '' : 'disabled'} title="הבא">⏭</button>
        </div>
        <label class="field">עוצמה ראשית: ${Math.round(state.masterVolume * 100)}%
          <input type="range" data-action="master" min="0" max="100" value="${Math.round(state.masterVolume * 100)}">
        </label>
        <label class="check">
          <input type="checkbox" data-action="host-speaker" ${player.unlocked ? 'checked disabled' : ''}>
          <span>${player.unlocked ? 'גם הטלפון שלי מנגן' : 'להשמיע גם מהטלפון שלי'}</span>
        </label>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>רשימת שירים</h2>
          <label class="btn small primary">
            + הוספת שירים
            <input type="file" id="files" accept="audio/*" multiple hidden>
          </label>
        </div>
        ${
          state.tracks.length
            ? `<ol class="playlist">${state.tracks
                .map(
                  (t) => `<li class="${t.id === pb.trackId ? 'current' : ''}">
                    <button class="link" data-action="play-track" data-id="${t.id}">${esc(t.name)}</button>
                    <span class="muted">${fmtTime(t.duration)}</span>
                    <button class="btn small ghost" data-action="remove-track" data-id="${t.id}" title="הסרה">✕</button>
                  </li>`,
                )
                .join('')}</ol>`
            : '<p class="muted">עוד לא הוספתם שירים. הקבצים עולים לשרת ומשם לכל הטלפונים.</p>'
        }
      </div>

      <div class="card">
        <h2>רמקולים מחוברים (${online.length})</h2>
        ${
          state.members.length
            ? state.members
                .map(
                  (m) => `<div class="member ${m.connected ? '' : 'offline'}">
                    <span class="dot ${m.connected ? (m.readyTrackId ? 'ready' : 'on') : ''}"></span>
                    <span class="name">${esc(m.name)}</span>
                    <input type="range" data-action="member-volume" data-id="${m.id}" min="0" max="100" value="${Math.round(m.volume * 100)}">
                    <button class="btn small ${m.muted ? 'primary' : 'ghost'}" data-action="mute" data-id="${m.id}" data-muted="${m.muted}">${m.muted ? '🔇' : '🔈'}</button>
                    <button class="btn small ghost" data-action="kick" data-id="${m.id}" title="הוצאה">✕</button>
                  </div>`,
                )
                .join('')
            : `<p class="muted">שתפו את הקוד <b dir="ltr">${esc(state.code)}</b> או את הקישור כדי שאנשים יצטרפו.</p>`
        }
      </div>

      <button class="btn danger wide" data-action="close-room">סגירת החדר</button>`;
  },
};

// Progress bars move every frame without re-rendering the page.
function updateProgress() {
  const track = currentTrack();
  if (!track) return;
  const pos = Math.min(player.position(), track.duration || Infinity);
  for (const el of $app.querySelectorAll('[data-pos]')) el.textContent = fmtTime(pos);
  const bar = $app.querySelector('[data-progress]');
  if (bar) bar.style.width = `${track.duration ? (pos / track.duration) * 100 : 0}%`;
  const seek = document.getElementById('seek');
  if (seek && document.activeElement !== seek) seek.value = String(Math.floor(pos));
}
(function loop() {
  updateProgress();
  requestAnimationFrame(loop);
})();

// ---------- events ----------

function saveName() {
  const name = document.getElementById('name')?.value.trim();
  if (name) store.set('name', name);
  return name;
}

$app.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = saveName();
  if (!name) {
    toast('כתבו קודם את השם שלכם');
    document.getElementById('name').focus();
    return;
  }
  notice = null;
  if (e.target.id === 'join-form') {
    const code = document.getElementById('code').value.trim().toUpperCase();
    if (code.length < 5) return toast('קוד החדר הוא 5 תווים');
    session = { code, token: null };
    send({ type: 'join', code, name });
  } else if (e.target.id === 'create-form') {
    session = { code: null, token: null };
    send({
      type: 'create',
      name,
      roomName: document.getElementById('room-name').value,
      isPrivate: document.getElementById('private').checked,
    });
    // The host's tap here is also the gesture that lets this phone play.
    player.unlock().catch(() => {});
  }
  render();
});

$app.addEventListener('input', (e) => {
  if (e.target.id === 'name') store.set('name', e.target.value.trim());
  if (e.target.id === 'calibration') {
    const ms = Number(e.target.value);
    store.set('calibrationMs', ms);
    player.setCalibration(ms);
  }
});

$app.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'files') {
    uploadFiles([...t.files]);
    t.value = '';
  } else if (t.id === 'seek') {
    send({ type: 'seek', position: Number(t.value) });
  } else if (t.id === 'calibration') {
    render();
  } else if (t.dataset.action === 'master') {
    send({ type: 'volume', volume: Number(t.value) / 100 });
  } else if (t.dataset.action === 'member-volume') {
    send({ type: 'volume', memberId: t.dataset.id, volume: Number(t.value) / 100 });
  } else if (t.dataset.action === 'private') {
    send({ type: 'set-private', isPrivate: t.checked });
  } else if (t.dataset.action === 'host-speaker' && t.checked) {
    player.unlock().then(requestWakeLock).catch(() => toast('לא הצלחנו להפעיל את הרמקול'));
  }
});

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.matches('input')) return;
  const { action, id } = el.dataset;
  switch (action) {
    case 'unlock':
      player
        .unlock()
        .then(requestWakeLock)
        .catch(() => toast('לא הצלחנו להפעיל את הרמקול'));
      break;
    case 'leave':
      send({ type: 'leave' });
      leaveLocally(null);
      break;
    case 'close-room':
      if (confirm('לסגור את החדר? כל המחוברים ינותקו.')) send({ type: 'close-room' });
      break;
    case 'share':
      shareLink();
      break;
    case 'play':
      send({ type: 'play' });
      break;
    case 'play-track':
      send({ type: 'play', trackId: id, position: 0 });
      break;
    case 'pause':
    case 'stop':
    case 'next':
      send({ type: action });
      break;
    case 'remove-track':
      send({ type: 'remove-track', trackId: id });
      break;
    case 'approve':
    case 'reject':
    case 'kick':
      send({ type: action, memberId: id });
      break;
    case 'mute':
      send({ type: 'mute', memberId: id, muted: el.dataset.muted !== 'true' });
      break;
  }
});

render();
connect();
