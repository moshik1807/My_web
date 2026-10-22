import { randomBytes, randomUUID } from 'node:crypto';

// No 0/O or 1/I so a code read aloud across a noisy room is unambiguous.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

export const MAX_TRACK_BYTES = 60 * 1024 * 1024;
export const MAX_ROOM_BYTES = 300 * 1024 * 1024;
export const MAX_NAME_LENGTH = 40;
// How far in the future a play/seek is scheduled, so every phone has time
// to receive the command and line its audio up before the first sample.
export const START_LEAD_MS = 1200;
// Rooms whose host has been gone this long are closed.
export const ROOM_IDLE_MS = 15 * 60 * 1000;

export class RoomError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function cleanName(value, fallback) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return name || fallback;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function makeCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

export class Room {
  constructor({ code, name, isPrivate, now }) {
    this.code = code;
    this.name = name;
    this.isPrivate = Boolean(isPrivate);
    this.createdAt = now;
    this.hostLeftAt = null;
    this.members = new Map();
    this.tracks = new Map();
    this.trackOrder = [];
    this.masterVolume = 1;
    this.playback = { rev: 0, trackId: null, status: 'stopped', startAt: null, position: 0 };
  }

  get host() {
    for (const m of this.members.values()) if (m.role === 'host') return m;
    return null;
  }

  get totalBytes() {
    let total = 0;
    for (const t of this.tracks.values()) total += t.size;
    return total;
  }

  addMember({ name, role, status }) {
    const member = {
      id: randomUUID(),
      token: randomBytes(18).toString('base64url'),
      name,
      role,
      status,
      volume: 1,
      muted: false,
      connected: false,
      latencyMs: null,
      readyTrackId: null,
      joinedAt: Date.now(),
    };
    this.members.set(member.id, member);
    return member;
  }

  memberByToken(token) {
    if (!token) return null;
    for (const m of this.members.values()) if (m.token === token) return m;
    return null;
  }

  requireMember(memberId) {
    const member = this.members.get(memberId);
    if (!member || member.role === 'host') throw new RoomError('no_member', 'המשתתף לא נמצא');
    return member;
  }

  approve(memberId) {
    const member = this.requireMember(memberId);
    member.status = 'approved';
    return member;
  }

  remove(memberId) {
    const member = this.requireMember(memberId);
    this.members.delete(memberId);
    return member;
  }

  setVolume(memberId, volume) {
    const v = clamp(volume, 0, 1);
    if (memberId == null) {
      this.masterVolume = v;
      return;
    }
    const member = this.members.get(memberId);
    if (member) member.volume = v;
  }

  setMuted(memberId, muted) {
    const member = this.members.get(memberId);
    if (member) member.muted = Boolean(muted);
  }

  // What a given phone should actually output, combining the host's master
  // volume with that phone's own slider and mute.
  effectiveVolume(member) {
    return member.muted ? 0 : this.masterVolume * member.volume;
  }

  addTrack({ name, mime, data, duration }) {
    if (!data?.length) throw new RoomError('empty', 'הקובץ ריק');
    if (data.length > MAX_TRACK_BYTES) throw new RoomError('too_big', 'הקובץ גדול מדי (עד 60MB)');
    if (this.totalBytes + data.length > MAX_ROOM_BYTES) throw new RoomError('room_full', 'אין מקום לעוד שירים בחדר');
    const track = {
      id: randomUUID(),
      name: cleanName(name, 'שיר ללא שם').slice(0, 120),
      mime: mime || 'application/octet-stream',
      size: data.length,
      duration: clamp(duration, 0, 24 * 3600),
      data,
    };
    this.tracks.set(track.id, track);
    this.trackOrder.push(track.id);
    return track;
  }

  removeTrack(trackId, now) {
    if (!this.tracks.delete(trackId)) return;
    this.trackOrder = this.trackOrder.filter((id) => id !== trackId);
    if (this.playback.trackId === trackId) this.stop(now);
  }

  positionAt(now) {
    const pb = this.playback;
    if (pb.status === 'playing') return Math.max(0, (now - pb.startAt) / 1000);
    return pb.position;
  }

  // startAt is the server time at which position 0 of the track is (or would
  // have been) heard. Phones derive everything else from it.
  play(trackId, position, now) {
    const id = trackId ?? this.playback.trackId ?? this.trackOrder[0];
    const track = this.tracks.get(id);
    if (!track) throw new RoomError('no_track', 'אין שיר לנגן');
    let pos = position;
    if (pos == null) pos = id === this.playback.trackId ? this.playback.position : 0;
    pos = clamp(pos, 0, track.duration || Infinity);
    this.playback = {
      rev: this.playback.rev + 1,
      trackId: id,
      status: 'playing',
      startAt: now + START_LEAD_MS - pos * 1000,
      position: pos,
    };
    return this.playback;
  }

  pause(now) {
    if (this.playback.status !== 'playing') return this.playback;
    this.playback = {
      ...this.playback,
      rev: this.playback.rev + 1,
      status: 'paused',
      position: this.positionAt(now),
      startAt: null,
    };
    return this.playback;
  }

  seek(position, now) {
    if (!this.playback.trackId) throw new RoomError('no_track', 'אין שיר נבחר');
    if (this.playback.status === 'playing') return this.play(this.playback.trackId, position, now);
    const track = this.tracks.get(this.playback.trackId);
    this.playback = {
      ...this.playback,
      rev: this.playback.rev + 1,
      status: 'paused',
      position: clamp(position, 0, track?.duration || Infinity),
    };
    return this.playback;
  }

  stop() {
    this.playback = { rev: this.playback.rev + 1, trackId: null, status: 'stopped', startAt: null, position: 0 };
    return this.playback;
  }

  // Moves to the next track in the playlist, or stops after the last one.
  next(now) {
    const idx = this.trackOrder.indexOf(this.playback.trackId);
    const nextId = this.trackOrder[idx + 1];
    if (!nextId) return this.stop(now);
    return this.play(nextId, 0, now);
  }

  // Milliseconds until the current track finishes, or null if nothing is
  // playing or the duration is unknown.
  msUntilEnd(now) {
    const pb = this.playback;
    const track = this.tracks.get(pb.trackId);
    if (pb.status !== 'playing' || !track?.duration) return null;
    return pb.startAt + track.duration * 1000 - now;
  }

  trackList() {
    return this.trackOrder.map((id) => {
      const { name, duration, size, mime } = this.tracks.get(id);
      return { id, name, duration, size, mime };
    });
  }

  publicMember(m) {
    return {
      id: m.id,
      name: m.name,
      role: m.role,
      status: m.status,
      volume: m.volume,
      muted: m.muted,
      connected: m.connected,
      latencyMs: m.latencyMs,
      readyTrackId: m.readyTrackId,
    };
  }

  // The state a phone sees. The host gets the full member list; guests only
  // what they need to play along.
  viewFor(member) {
    const base = {
      code: this.code,
      name: this.name,
      isPrivate: this.isPrivate,
      role: member.role,
      status: member.status,
      memberId: member.id,
      hostName: this.host?.name ?? '',
      hostOnline: Boolean(this.host?.connected),
    };
    if (member.status !== 'approved') return base;
    const approved = [...this.members.values()].filter((m) => m.status === 'approved');
    const view = {
      ...base,
      volume: this.effectiveVolume(member),
      playback: this.playback,
      tracks: this.trackList(),
      speakers: approved.filter((m) => m.connected).length,
    };
    if (member.role === 'host') {
      view.masterVolume = this.masterVolume;
      view.members = approved.filter((m) => m.role !== 'host').map((m) => this.publicMember(m));
      view.pending = [...this.members.values()].filter((m) => m.status === 'pending').map((m) => this.publicMember(m));
      view.hostMember = this.publicMember(member);
    }
    return view;
  }
}

export class RoomManager {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.rooms = new Map();
  }

  get(code) {
    return this.rooms.get(String(code ?? '').trim().toUpperCase()) ?? null;
  }

  require(code) {
    const room = this.get(code);
    if (!room) throw new RoomError('no_room', 'החדר לא נמצא. בדקו את הקוד.');
    return room;
  }

  create({ hostName, roomName, isPrivate }) {
    let code;
    do code = makeCode();
    while (this.rooms.has(code));
    const name = cleanName(hostName, 'מארח');
    const room = new Room({
      code,
      name: cleanName(roomName, `המסיבה של ${name}`),
      isPrivate,
      now: this.now(),
    });
    const host = room.addMember({ name, role: 'host', status: 'approved' });
    this.rooms.set(code, room);
    return { room, member: host };
  }

  // Joining with a token from an earlier session resumes that membership,
  // so a phone that drops off Wi-Fi comes back without asking again.
  join({ code, name, token }) {
    const room = this.require(code);
    const existing = room.memberByToken(token);
    if (existing) return { room, member: existing, resumed: true };
    const member = room.addMember({
      name: cleanName(name, 'אורח'),
      role: 'guest',
      status: room.isPrivate ? 'pending' : 'approved',
    });
    return { room, member, resumed: false };
  }

  close(code) {
    this.rooms.delete(code);
  }

  // Returns the codes of rooms closed because their host left long ago.
  sweep() {
    const now = this.now();
    const closed = [];
    for (const [code, room] of this.rooms) {
      if (room.hostLeftAt != null && now - room.hostLeftAt > ROOM_IDLE_MS) {
        this.rooms.delete(code);
        closed.push(code);
      }
    }
    return closed;
  }
}
