import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { RoomManager, RoomError, MAX_TRACK_BYTES } from './rooms.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const HOST_ACTIONS = new Set([
  'approve', 'reject', 'kick', 'volume', 'mute', 'play', 'pause', 'seek', 'stop', 'next',
  'remove-track', 'set-private', 'close-room',
]);

export function createServer({ now = () => Date.now(), sweepMs = 60_000 } = {}) {
  const manager = new RoomManager({ now });
  // code -> Map(memberId -> WebSocket)
  const sockets = new Map();
  // code -> timeout handle that advances to the next track
  const endTimers = new Map();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(PUBLIC_DIR));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: manager.rooms.size, time: now() });
  });

  app.get('/api/rooms/:code', (req, res) => {
    const room = manager.get(req.params.code);
    if (!room) return res.status(404).json({ error: 'החדר לא נמצא' });
    res.json({ code: room.code, name: room.name, isPrivate: room.isPrivate, hostName: room.host?.name ?? '' });
  });

  app.post(
    '/api/rooms/:code/tracks',
    express.raw({ type: () => true, limit: MAX_TRACK_BYTES }),
    (req, res) => {
      const room = manager.get(req.params.code);
      const member = room?.memberByToken(req.get('x-token'));
      if (!member || member.role !== 'host') return res.status(403).json({ error: 'רק בעל החדר יכול להעלות שירים' });
      try {
        const track = room.addTrack({
          name: decodeURIComponent(req.get('x-track-name') || ''),
          mime: req.get('content-type'),
          duration: Number(req.get('x-track-duration')),
          data: req.body,
        });
        broadcast(room);
        res.status(201).json({ id: track.id, name: track.name, duration: track.duration });
      } catch (err) {
        if (err instanceof RoomError) return res.status(400).json({ error: err.message });
        throw err;
      }
    },
  );

  app.get('/api/rooms/:code/tracks/:id', (req, res) => {
    const room = manager.get(req.params.code);
    const member = room?.memberByToken(req.query.token);
    if (!member || member.status !== 'approved') return res.status(403).end();
    const track = room.tracks.get(req.params.id);
    if (!track) return res.status(404).end();
    res.set({ 'content-type': track.mime, 'cache-control': 'private, max-age=86400' });
    res.send(track.data);
  });

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'הקובץ גדול מדי (עד 60MB)' });
    console.error(err);
    res.status(500).json({ error: 'שגיאת שרת' });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

  function send(ws, msg) {
    if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function roomSockets(room) {
    let map = sockets.get(room.code);
    if (!map) sockets.set(room.code, (map = new Map()));
    return map;
  }

  function broadcast(room) {
    for (const [memberId, ws] of roomSockets(room)) {
      const member = room.members.get(memberId);
      if (member) send(ws, { type: 'state', state: room.viewFor(member) });
    }
  }

  function sendToHost(room) {
    const host = room.host;
    if (host) send(roomSockets(room).get(host.id), { type: 'state', state: room.viewFor(host) });
  }

  // The server, not the host's phone, moves the playlist along, so music
  // keeps going even if the host's screen locks.
  function scheduleEnd(room) {
    clearTimeout(endTimers.get(room.code));
    endTimers.delete(room.code);
    const ms = room.msUntilEnd(now());
    if (ms == null) return;
    endTimers.set(
      room.code,
      setTimeout(() => {
        endTimers.delete(room.code);
        if (manager.get(room.code) !== room) return;
        room.next(now());
        scheduleEnd(room);
        broadcast(room);
      }, Math.max(0, ms) + 250),
    );
  }

  function closeRoom(room, reason) {
    clearTimeout(endTimers.get(room.code));
    endTimers.delete(room.code);
    for (const ws of roomSockets(room).values()) {
      send(ws, { type: 'closed', reason });
      ws.close();
    }
    sockets.delete(room.code);
    manager.close(room.code);
  }

  function attach(ws, ctx, room, member) {
    const map = roomSockets(room);
    const previous = map.get(member.id);
    if (previous && previous !== ws) {
      send(previous, { type: 'replaced' });
      previous.close();
    }
    map.set(member.id, ws);
    ctx.room = room;
    ctx.member = member;
    member.connected = true;
    if (member.role === 'host') room.hostLeftAt = null;
    send(ws, { type: 'session', code: room.code, token: member.token, memberId: member.id, role: member.role });
    broadcast(room);
  }

  function handleHost(room, msg) {
    const t = now();
    switch (msg.type) {
      case 'approve':
        room.approve(msg.memberId);
        break;
      case 'reject':
      case 'kick': {
        const member = room.remove(msg.memberId);
        const ws = roomSockets(room).get(member.id);
        roomSockets(room).delete(member.id);
        send(ws, { type: msg.type === 'reject' ? 'rejected' : 'kicked' });
        ws?.close();
        break;
      }
      case 'volume':
        room.setVolume(msg.memberId ?? null, msg.volume);
        break;
      case 'mute':
        room.setMuted(msg.memberId, msg.muted);
        break;
      case 'play':
        room.play(msg.trackId ?? null, msg.position ?? null, t);
        break;
      case 'pause':
        room.pause(t);
        break;
      case 'seek':
        room.seek(msg.position, t);
        break;
      case 'stop':
        room.stop(t);
        break;
      case 'next':
        room.next(t);
        break;
      case 'remove-track':
        room.removeTrack(msg.trackId, t);
        break;
      case 'set-private':
        room.isPrivate = Boolean(msg.isPrivate);
        break;
      case 'close-room':
        closeRoom(room, 'host');
        return;
    }
    scheduleEnd(room);
    broadcast(room);
  }

  wss.on('connection', (ws) => {
    const ctx = { room: null, member: null };

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;

      // Clock sync is answered immediately and needs no room.
      if (msg.type === 'ping') {
        send(ws, { type: 'pong', t0: msg.t0, ts: now() });
        return;
      }

      try {
        if (msg.type === 'create') {
          const { room, member } = manager.create({
            hostName: msg.name,
            roomName: msg.roomName,
            isPrivate: msg.isPrivate,
          });
          attach(ws, ctx, room, member);
          return;
        }
        if (msg.type === 'join') {
          const { room, member } = manager.join({ code: msg.code, name: msg.name, token: msg.token });
          attach(ws, ctx, room, member);
          return;
        }

        const { room, member } = ctx;
        if (!room || !member || manager.get(room.code) !== room || !room.members.has(member.id)) {
          throw new RoomError('no_session', 'לא מחוברים לחדר');
        }

        if (msg.type === 'report') {
          member.latencyMs = Number.isFinite(msg.latencyMs) ? Math.round(msg.latencyMs) : null;
          member.readyTrackId = typeof msg.readyTrackId === 'string' ? msg.readyTrackId : null;
          sendToHost(room);
          return;
        }
        if (msg.type === 'leave') {
          if (member.role === 'host') {
            closeRoom(room, 'host');
          } else {
            room.members.delete(member.id);
            roomSockets(room).delete(member.id);
            ctx.room = ctx.member = null;
            broadcast(room);
          }
          return;
        }
        if (HOST_ACTIONS.has(msg.type)) {
          if (member.role !== 'host') throw new RoomError('forbidden', 'רק בעל החדר יכול לעשות את זה');
          handleHost(room, msg);
        }
      } catch (err) {
        if (!(err instanceof RoomError)) {
          console.error(err);
          send(ws, { type: 'error', code: 'internal', message: 'שגיאת שרת' });
          return;
        }
        send(ws, { type: 'error', code: err.code, message: err.message });
      }
    });

    ws.on('close', () => {
      const { room, member } = ctx;
      if (!room || roomSockets(room).get(member.id) !== ws) return;
      roomSockets(room).delete(member.id);
      member.connected = false;
      if (member.role === 'host') room.hostLeftAt = now();
      broadcast(room);
    });
  });

  const sweeper = setInterval(() => {
    for (const code of manager.sweep()) {
      clearTimeout(endTimers.get(code));
      endTimers.delete(code);
      for (const ws of sockets.get(code)?.values() ?? []) {
        send(ws, { type: 'closed', reason: 'idle' });
        ws.close();
      }
      sockets.delete(code);
    }
  }, sweepMs);
  sweeper.unref();

  // Drops every phone and stops timers so the process can exit.
  function stop() {
    clearInterval(sweeper);
    for (const timer of endTimers.values()) clearTimeout(timer);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  }

  return { app, server, manager, stop };
}
