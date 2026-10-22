import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, RoomError, START_LEAD_MS, ROOM_IDLE_MS } from '../server/rooms.js';

function setup({ isPrivate = false } = {}) {
  let t = 1_000_000;
  const manager = new RoomManager({ now: () => t });
  const { room, member: host } = manager.create({ hostName: 'דנה', roomName: 'מסיבה', isPrivate });
  return { manager, room, host, now: () => t, advance: (ms) => (t += ms) };
}

const addTrack = (room, duration = 180) =>
  room.addTrack({ name: 'song', mime: 'audio/mpeg', data: Buffer.alloc(10), duration });

test('codes are five unambiguous characters', () => {
  const { room } = setup();
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{5}$/);
});

test('public rooms admit guests immediately, private rooms queue them', () => {
  const pub = setup();
  assert.equal(pub.manager.join({ code: pub.room.code, name: 'אבי' }).member.status, 'approved');

  const priv = setup({ isPrivate: true });
  const { member } = priv.manager.join({ code: priv.room.code.toLowerCase(), name: 'אבי' });
  assert.equal(member.status, 'pending');
  assert.equal(priv.room.viewFor(member).playback, undefined, 'pending guests see no room content');
  assert.equal(priv.room.viewFor(priv.host).pending.length, 1);

  priv.room.approve(member.id);
  assert.equal(member.status, 'approved');
  assert.ok(priv.room.viewFor(member).playback);
});

test('joining with a known token resumes the same membership', () => {
  const { manager, room } = setup({ isPrivate: true });
  const first = manager.join({ code: room.code, name: 'אבי' }).member;
  room.approve(first.id);
  const again = manager.join({ code: room.code, name: 'שם אחר', token: first.token });
  assert.equal(again.resumed, true);
  assert.equal(again.member, first);
  assert.equal(again.member.status, 'approved');
});

test('unknown room codes are rejected', () => {
  const { manager } = setup();
  assert.throws(() => manager.join({ code: 'ZZZZZ', name: 'x' }), RoomError);
});

test('play schedules ahead, pause and resume keep the position', () => {
  const { room, now, advance } = setup();
  const track = addTrack(room);

  const pb = room.play(null, null, now());
  assert.equal(pb.trackId, track.id);
  assert.equal(pb.startAt, now() + START_LEAD_MS);

  advance(START_LEAD_MS + 10_000);
  room.pause(now());
  assert.equal(room.playback.status, 'paused');
  assert.equal(room.playback.position, 10);

  advance(60_000);
  room.play(null, null, now());
  assert.equal(room.playback.startAt, now() + START_LEAD_MS - 10_000);
});

test('seek while playing reschedules, seek while paused just moves', () => {
  const { room, now } = setup();
  addTrack(room);
  room.play(null, 0, now());
  room.seek(42, now());
  assert.equal(room.playback.status, 'playing');
  assert.equal(room.playback.startAt, now() + START_LEAD_MS - 42_000);

  room.pause(now());
  room.seek(500, now());
  assert.equal(room.playback.position, 180, 'clamped to the track length');
});

test('every playback change bumps the revision', () => {
  const { room, now } = setup();
  addTrack(room);
  const revs = [room.playback.rev];
  for (const op of [() => room.play(null, 0, now()), () => room.pause(now()), () => room.seek(5, now()), () => room.stop()]) {
    op();
    revs.push(room.playback.rev);
  }
  assert.deepEqual(revs, [0, 1, 2, 3, 4]);
});

test('next walks the playlist and stops after the last track', () => {
  const { room, now } = setup();
  const a = addTrack(room);
  const b = addTrack(room);
  room.play(a.id, 0, now());
  room.next(now());
  assert.equal(room.playback.trackId, b.id);
  room.next(now());
  assert.equal(room.playback.status, 'stopped');
});

test('removing the playing track stops playback', () => {
  const { room, now } = setup();
  const a = addTrack(room);
  room.play(a.id, 0, now());
  room.removeTrack(a.id, now());
  assert.equal(room.playback.status, 'stopped');
  assert.equal(room.tracks.size, 0);
});

test('msUntilEnd counts down to the end of the track', () => {
  const { room, now, advance } = setup();
  addTrack(room, 30);
  assert.equal(room.msUntilEnd(now()), null);
  room.play(null, 0, now());
  advance(START_LEAD_MS + 20_000);
  assert.equal(room.msUntilEnd(now()), 10_000);
});

test('effective volume combines master, member volume and mute', () => {
  const { manager, room } = setup();
  const { member } = manager.join({ code: room.code, name: 'אבי' });
  room.setVolume(null, 0.5);
  room.setVolume(member.id, 0.5);
  assert.equal(room.viewFor(member).volume, 0.25);
  room.setMuted(member.id, true);
  assert.equal(room.viewFor(member).volume, 0);
  room.setVolume(null, 7);
  assert.equal(room.masterVolume, 1, 'clamped');
});

test('guests do not see the member list, the host does', () => {
  const { manager, room, host } = setup();
  const { member } = manager.join({ code: room.code, name: 'אבי' });
  assert.equal(room.viewFor(member).members, undefined);
  assert.deepEqual(room.viewFor(host).members.map((m) => m.name), ['אבי']);
  assert.equal(JSON.stringify(room.viewFor(host)).includes(member.token), false, 'tokens never leak');
});

test('the host cannot be kicked', () => {
  const { room, host } = setup();
  assert.throws(() => room.remove(host.id), RoomError);
});

test('sweep closes rooms whose host has been gone too long', () => {
  const { manager, room, now, advance } = setup();
  room.hostLeftAt = now();
  advance(ROOM_IDLE_MS - 1);
  assert.deepEqual(manager.sweep(), []);
  advance(2);
  assert.deepEqual(manager.sweep(), [room.code]);
  assert.equal(manager.get(room.code), null);
});
