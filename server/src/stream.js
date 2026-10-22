// Geofenced asset streaming: the client reports its pose, the server pushes asset manifests
// for every site within reach, once per site and era (the client caches what it has received).
import { WebSocketServer } from 'ws';
import { findNearby, assetsForYear } from './app.js';

const FENCE_M = Number(process.env.GEOFENCE_RADIUS_M || 300);

export function attachStream(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    const sent = new Set();
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return ws.send(JSON.stringify({ type: 'error', error: 'invalid JSON' })); }
      if (msg.type !== 'pose') return;
      const { lat, lng, year } = msg;
      if (![lat, lng, year].every(Number.isFinite)) return ws.send(JSON.stringify({ type: 'error', error: 'pose needs numeric lat, lng, year' }));
      try {
        for (const loc of await findNearby(lat, lng, FENCE_M)) {
          const assets = await assetsForYear(loc.id, year);
          const key = `${loc.id}:${assets.map((a) => a.id).join(',')}`;
          if (sent.has(key)) continue;
          sent.add(key);
          ws.send(JSON.stringify({
            type: 'manifest', location: loc, year,
            assets: assets.map(({ id, asset_type, model_url, lod_level }) => ({ id, asset_type, model_url, lod_level })),
          }));
        }
      } catch (err) {
        console.error(err);
        ws.send(JSON.stringify({ type: 'error', error: 'query failed' }));
      }
    });
  });
  return wss;
}
