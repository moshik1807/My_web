import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localToGeo, geoToLocal } from '../src/geo.js';

const origin = { lat: 32.05497, lng: 34.75633 };

test('local <-> WGS84 round trip stays within a millimetre', () => {
  for (const [x, z] of [[0, 0], [38, -24], [-150, 150], [12.5, 3.25]]) {
    const g = localToGeo(origin, x, z);
    const l = geoToLocal(origin, g.lat, g.lng);
    assert.ok(Math.abs(l.x - x) < 1e-3 && Math.abs(l.z - z) < 1e-3, `${x},${z} -> ${l.x},${l.z}`);
  }
});

test('north is negative z, east is positive x', () => {
  const n = localToGeo(origin, 0, -100), e = localToGeo(origin, 100, 0);
  assert.ok(n.lat > origin.lat && Math.abs(n.lng - origin.lng) < 1e-12);
  assert.ok(e.lng > origin.lng && Math.abs(e.lat - origin.lat) < 1e-12);
});
