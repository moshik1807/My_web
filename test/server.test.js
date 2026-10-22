import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createServer } from '../server/app.js';

async function start() {
  const { server, stop } = createServer();
  server.listen(0);
  await once(server, 'listening');
  const base = `http://localhost:${server.address().port}`;
  return { stop, base, wsUrl: base.replace('http', 'ws') + '/ws' };
}

// A test client that remembers every message and can wait for one.
async function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (w.match(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  await once(ws, 'open');
  return {
    ws,
    send: (msg) => ws.send(JSON.stringify(msg)),
    next(match, label = 'message') {
      const found = inbox.find(match);
      if (found) {
        inbox.splice(inbox.indexOf(found), 1);
        return Promise.resolve(found);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 2000);
        waiters.push({ match, resolve: (m) => (clearTimeout(timer), inbox.splice(inbox.indexOf(m), 1), resolve(m)) });
      });
    },
    state(pred = () => true) {
      return this.next((m) => m.type === 'state' && pred(m.state), 'state');
    },
  };
}

test('full flow: private room, approval, upload, synced playback', async (t) => {
  const { stop, base, wsUrl } = await start();
  t.after(stop);

  const host = await client(wsUrl);
  host.send({ type: 'ping', t0: 123 });
  const pong = await host.next((m) => m.type === 'pong');
  assert.equal(pong.t0, 123);
  assert.ok(Math.abs(pong.ts - Date.now()) < 1000);

  host.send({ type: 'create', name: 'דנה', roomName: 'חתונה', isPrivate: true });
  const hostSession = await host.next((m) => m.type === 'session');
  assert.equal(hostSession.role, 'host');
  const { code } = hostSession;

  const info = await (await fetch(`${base}/api/rooms/${code}`)).json();
  assert.equal(info.name, 'חתונה');
  assert.equal(info.isPrivate, true);

  const guest = await client(wsUrl);
  guest.send({ type: 'join', code, name: 'אבי' });
  const guestSession = await guest.next((m) => m.type === 'session');
  await guest.state((s) => s.status === 'pending');

  // A pending guest can't control or download anything.
  guest.send({ type: 'play' });
  assert.equal((await guest.next((m) => m.type === 'error')).code, 'forbidden');

  const hostView = await host.state((s) => s.pending?.length === 1);
  host.send({ type: 'approve', memberId: hostView.state.pending[0].id });
  await guest.state((s) => s.status === 'approved');

  const forbidden = await fetch(`${base}/api/rooms/${code}/tracks`, {
    method: 'POST',
    headers: { 'x-token': guestSession.token },
    body: 'nope',
  });
  assert.equal(forbidden.status, 403, 'guests cannot upload');

  const audio = Buffer.from('fake-mp3-bytes');
  const upload = await fetch(`${base}/api/rooms/${code}/tracks`, {
    method: 'POST',
    headers: {
      'content-type': 'audio/mpeg',
      'x-token': hostSession.token,
      'x-track-name': encodeURIComponent('שיר ראשון'),
      'x-track-duration': '200',
    },
    body: audio,
  });
  assert.equal(upload.status, 201);
  const track = await upload.json();
  assert.equal(track.name, 'שיר ראשון');

  const withTrack = await guest.state((s) => s.tracks?.length === 1);
  assert.equal(withTrack.state.tracks[0].duration, 200);

  const dl = await fetch(`${base}/api/rooms/${code}/tracks/${track.id}?token=${guestSession.token}`);
  assert.equal(dl.status, 200);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), audio);
  assert.equal((await fetch(`${base}/api/rooms/${code}/tracks/${track.id}?token=bad`)).status, 403);

  const before = Date.now();
  host.send({ type: 'play', trackId: track.id, position: 0 });
  const playing = await guest.state((s) => s.playback?.status === 'playing');
  assert.ok(playing.state.playback.startAt > before, 'playback is scheduled in the future');

  host.send({ type: 'volume', memberId: hostView.state.pending[0].id, volume: 0.4 });
  await guest.state((s) => s.volume === 0.4);

  guest.send({ type: 'report', latencyMs: 87.6, readyTrackId: track.id });
  const reported = await host.state((s) => s.members?.[0]?.readyTrackId === track.id);
  assert.equal(reported.state.members[0].latencyMs, 88);

  host.send({ type: 'kick', memberId: hostView.state.pending[0].id });
  await guest.next((m) => m.type === 'kicked');
});

test('a guest reconnecting with its token resumes, and closing the room disconnects everyone', async (t) => {
  const { stop, wsUrl } = await start();
  t.after(stop);

  const host = await client(wsUrl);
  host.send({ type: 'create', name: 'דנה' });
  const { code } = await host.next((m) => m.type === 'session');

  const guest = await client(wsUrl);
  guest.send({ type: 'join', code, name: 'אבי' });
  const { token, memberId } = await guest.next((m) => m.type === 'session');
  guest.ws.close();
  await host.state((s) => s.members?.[0]?.connected === false);

  const again = await client(wsUrl);
  again.send({ type: 'join', code, token });
  const resumed = await again.next((m) => m.type === 'session');
  assert.equal(resumed.memberId, memberId);
  await host.state((s) => s.members?.length === 1 && s.members[0].connected);

  host.send({ type: 'close-room' });
  assert.equal((await again.next((m) => m.type === 'closed')).reason, 'host');

  const late = await client(wsUrl);
  late.send({ type: 'join', code, name: 'x' });
  assert.equal((await late.next((m) => m.type === 'error')).code, 'no_room');
  late.ws.close();
});
