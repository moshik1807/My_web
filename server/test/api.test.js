// Integration tests against a seeded PostGIS database (npm run migrate && npm run seed).
// Skipped when DATABASE_URL is not set.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import WebSocket from 'ws';

const enabled = !!process.env.DATABASE_URL;
let server, base, pool, locId;

before(async () => {
  if (!enabled) return;
  const { createApp } = await import('../src/app.js');
  const { attachStream } = await import('../src/stream.js');
  ({ pool } = await import('../src/db.js'));
  server = http.createServer(createApp()); attachStream(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (enabled) { await new Promise((r) => server.close(r)); await pool.end(); } });

const get = async (path) => { const r = await fetch(base + path); return { status: r.status, body: await r.json() }; };

test('health reports PostGIS', { skip: !enabled }, async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200); assert.equal(body.ok, true); assert.match(body.postgis, /^3\./);
});

test('nearby finds the seeded square and sorts by distance', { skip: !enabled }, async () => {
  const { body } = await get('/api/locations/nearby?lat=32.0551&lng=34.7565&radius=500');
  assert.ok(body.locations.length >= 1);
  locId = body.locations[0].id;
  assert.ok(body.locations[0].distance_m < 50);
  const far = await get('/api/locations/nearby?lat=31.7683&lng=35.2137&radius=500');
  assert.equal(far.body.locations.length, 0);
});

test('rejects bad input with 400', { skip: !enabled }, async () => {
  assert.equal((await get('/api/locations/nearby?lat=abc&lng=1')).status, 400);
  assert.equal((await get('/api/locations/not-a-uuid/assets?year=1900')).status, 400);
  assert.equal((await get('/api/locations/00000000-0000-0000-0000-000000000000')).status, 404);
});

test('assets and paths follow the year', { skip: !enabled }, async () => {
  const a = await get(`/api/locations/${locId}/assets?year=1915`);
  assert.ok(a.body.assets.every((x) => x.year_start <= 1915 && x.year_end >= 1915));
  assert.ok(a.body.assets.some((x) => x.model_url === 'procedural://landmark/clock_tower'));
  const early = await get(`/api/locations/${locId}/assets?year=1890`);
  assert.ok(!early.body.assets.some((x) => x.model_url === 'procedural://landmark/clock_tower'));
  const p = await get(`/api/locations/${locId}/paths?year=1915`);
  assert.equal(p.body.era_year, 1920);
  assert.ok(p.body.features.some((f) => f.properties.entity_type === 'vintage_car'));
});

test('timeline round-trips the bundled dataset', { skip: !enabled }, async () => {
  const demo = JSON.parse(await readFile(new URL('../../client/data/jaffa-demo.json', import.meta.url), 'utf8'));
  const { body } = await get(`/api/locations/${locId}/timeline`);
  assert.deepEqual(body.eras.map((e) => e.year), demo.eras.map((e) => e.year));
  for (const [i, era] of body.eras.entries()) {
    const src = demo.eras[i];
    assert.equal(era.entities.length, src.entities.length);
    era.entities.forEach((e, k) => {
      const pts = demo.paths[src.entities[k].path];
      e.path.forEach(([x, z], j) => { assert.ok(Math.abs(x - pts[j][0]) < 0.02 && Math.abs(z - pts[j][1]) < 0.02); });
    });
  }
  assert.deepEqual(body.blocks.north, demo.blocks.north);
});

test('AI transform validates input and reports when no key is configured', { skip: !enabled }, async () => {
  const post = (body) => fetch(base + '/api/ai/transform', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const health = await get('/api/health');
  if (!health.body.ai) assert.equal((await post({ image: 'abc', prompt: 'x' })).status, 503);
  else assert.equal((await post({ prompt: 'x' })).status, 400);
});

test('stream pushes a manifest once per site and era', { skip: !enabled }, async () => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const msgs = [];
  ws.on('message', (m) => msgs.push(JSON.parse(m)));
  await new Promise((r) => ws.on('open', r));
  const pose = (year) => ws.send(JSON.stringify({ type: 'pose', lat: 32.0551, lng: 34.7565, year }));
  pose(1920); pose(1921); pose(1980);
  await new Promise((r) => setTimeout(r, 600));
  ws.close();
  const manifests = msgs.filter((m) => m.type === 'manifest');
  assert.deepEqual(manifests.map((m) => m.year), [1920, 1980]);
  assert.ok(manifests[0].assets.length > 0);
});
