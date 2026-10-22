import express from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { query } from './db.js';
import { geoToLocal, round } from './geo.js';

const CLIENT_DIR = process.env.CLIENT_DIR || fileURLToPath(new URL('../../client/', import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const num = (v, name, { min = -Infinity, max = Infinity, fallback } = {}) => {
  if ((v === undefined || v === '') && fallback !== undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} must be a number between ${min} and ${max}`);
  return n;
};
const uuid = (v) => { if (!UUID.test(v)) throw new HttpError(400, 'location id must be a UUID'); return v; };
const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export async function getLocation(id) {
  const { rows } = await query(
    'SELECT id, name, ST_Y(coordinates) AS lat, ST_X(coordinates) AS lng FROM spatial_locations WHERE id = $1', [id]);
  if (!rows.length) throw new HttpError(404, 'location not found');
  return rows[0];
}

export async function findNearby(lat, lng, radius, limit = 20) {
  const { rows } = await query(
    `SELECT id, name, ST_Y(coordinates) AS lat, ST_X(coordinates) AS lng,
            ST_Distance(coordinates::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_m
       FROM spatial_locations
      WHERE ST_DWithin(coordinates::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
      ORDER BY distance_m
      LIMIT $4`,
    [lat, lng, radius, limit]);
  return rows.map((r) => ({ ...r, distance_m: round(r.distance_m, 1) }));
}

export async function assetsForYear(id, year, lod) {
  const params = [id, year];
  let sql = `SELECT id, year_start, year_end, asset_type, model_url, lod_level, metadata
               FROM historical_assets
              WHERE location_id = $1 AND $2 BETWEEN year_start AND year_end`;
  if (lod !== undefined) { params.push(lod); sql += ' AND lod_level = $3'; }
  const { rows } = await query(sql + ' ORDER BY asset_type, year_start', params);
  return rows;
}

/** Era a calendar year belongs to: the era whose terrain asset spans it, else the era with the closest key year. */
export async function eraYearFor(id, year) {
  const { rows } = await query(
    `SELECT COALESCE(
        (SELECT (metadata->'era'->>'year')::int FROM historical_assets
          WHERE location_id = $1 AND asset_type = 'terrain' AND $2 BETWEEN year_start AND year_end
          ORDER BY year_start DESC LIMIT 1),
        (SELECT era_year FROM entity_paths WHERE location_id = $1
          ORDER BY abs(era_year - $2), era_year LIMIT 1)) AS era_year`, [id, year]);
  return rows[0].era_year;
}

export async function pathsForEra(id, eraYear) {
  const { rows } = await query(
    `SELECT id, era_year, entity_type, speed_mps::float AS speed_mps, spawn_interval_sec,
            ST_AsGeoJSON(path_geometry)::json AS geometry, ST_Length(path_geometry::geography) AS length_m
       FROM entity_paths WHERE location_id = $1 AND era_year = $2 ORDER BY entity_type`, [id, eraYear]);
  return rows;
}

/** Assemble the client-ready timeline (same shape as client/data/jaffa-demo.json) from database rows. */
export async function buildTimeline(id) {
  const loc = await getLocation(id);
  const origin = { lat: loc.lat, lng: loc.lng };
  const { rows: assets } = await query(
    `SELECT asset_type, year_start, year_end, model_url, metadata FROM historical_assets
      WHERE location_id = $1 ORDER BY year_start, created_at`, [id]);
  const { rows: paths } = await query(
    `SELECT era_year, entity_type, speed_mps::float AS speed_mps, spawn_interval_sec, ST_AsGeoJSON(path_geometry)::json AS geometry
       FROM entity_paths WHERE location_id = $1 ORDER BY era_year`, [id]);

  const eras = new Map(); const blocks = {}; const landmarks = []; let meta = {};
  for (const a of assets) {
    const m = a.metadata || {};
    if (a.asset_type === 'terrain' && m.era) {
      meta = m;
      eras.set(m.era.year, { ...m.era, year_start: a.year_start, year_end: a.year_end, environment: m.environment, buildings: [], entities: [] });
    }
  }
  for (const a of assets) {
    const m = a.metadata || {};
    if (m.landmark) { landmarks.push({ ...m.landmark, year_start: a.year_start, year_end: a.year_end }); continue; }
    if (a.asset_type !== 'building' || m.era_year === undefined) continue;
    const era = eras.get(m.era_year); if (!era) continue;
    if (m.block_geom) blocks[m.block] = m.block_geom;
    const { block_geom, era_year, ...spec } = m;
    era.buildings.push(spec);
  }
  for (const p of paths) {
    const era = eras.get(p.era_year); if (!era) continue;
    const pts = p.geometry.coordinates.map(([lng, lat]) => { const l = geoToLocal(origin, lat, lng); return [round(l.x), round(l.z)]; });
    era.entities.push({ entity_type: p.entity_type, path: pts, speed_mps: p.speed_mps, spawn_interval_sec: p.spawn_interval_sec });
  }
  return {
    location: { id: loc.id, key: meta.location_key, name: loc.name, name_en: meta.name_en, lat: loc.lat, lng: loc.lng, radius_m: meta.radius_m },
    blocks, landmarks, eras: [...eras.values()].sort((a, b) => a.year - b.year),
  };
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/health', route(async (req, res) => {
    const { rows } = await query('SELECT postgis_version() AS postgis');
    res.json({ ok: true, postgis: rows[0].postgis, ai: !!process.env.GEMINI_API_KEY });
  }));

  // "Photo from the past" through the server's own Gemini key, so the key never reaches browsers.
  app.post('/api/ai/transform', express.json({ limit: '12mb' }), route(async (req, res) => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new HttpError(503, 'AI is not configured on this server (set GEMINI_API_KEY)');
    const { image, mime = 'image/jpeg', prompt } = req.body || {};
    if (typeof image !== 'string' || !image.length || typeof prompt !== 'string' || !prompt.trim()) throw new HttpError(400, 'image (base64) and prompt are required');
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new HttpError(400, 'mime must be image/jpeg, image/png or image/webp');
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt.slice(0, 8000) }, { inline_data: { mime_type: mime, data: image } }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
    });
    const j = await upstream.json().catch(() => ({}));
    if (!upstream.ok) throw new HttpError(upstream.status === 429 ? 429 : 502, j.error?.message || `upstream error ${upstream.status}`);
    const part = (j.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData || p.inline_data);
    if (!part) throw new HttpError(502, 'the model returned no image');
    const d = part.inlineData || part.inline_data;
    res.json({ image: d.data, mime: d.mimeType || d.mime_type || 'image/png' });
  }));

  app.get('/api/locations/nearby', route(async (req, res) => {
    const lat = num(req.query.lat, 'lat', { min: -90, max: 90 });
    const lng = num(req.query.lng, 'lng', { min: -180, max: 180 });
    const radius = num(req.query.radius, 'radius', { min: 1, max: 50000, fallback: 500 });
    res.json({ locations: await findNearby(lat, lng, radius) });
  }));

  app.get('/api/locations/:id', route(async (req, res) => res.json(await getLocation(uuid(req.params.id)))));

  app.get('/api/locations/:id/assets', route(async (req, res) => {
    const id = uuid(req.params.id); await getLocation(id);
    const year = num(req.query.year, 'year', { min: -5000, max: 3000 });
    const lod = req.query.lod === undefined ? undefined : num(req.query.lod, 'lod', { min: 0, max: 2 });
    res.json({ year, assets: await assetsForYear(id, year, lod) });
  }));

  app.get('/api/locations/:id/paths', route(async (req, res) => {
    const id = uuid(req.params.id); await getLocation(id);
    const year = num(req.query.year, 'year', { min: -5000, max: 3000 });
    const eraYear = await eraYearFor(id, year);
    const rows = eraYear === null ? [] : await pathsForEra(id, eraYear);
    res.json({
      type: 'FeatureCollection', era_year: eraYear,
      features: rows.map(({ geometry, ...props }) => ({ type: 'Feature', geometry, properties: { ...props, length_m: round(props.length_m, 1) } })),
    });
  }));

  app.get('/api/locations/:id/timeline', route(async (req, res) => res.json(await buildTimeline(uuid(req.params.id)))));

  // Serve the web client; the injected meta tag tells it the API lives on this origin.
  const serveIndex = route(async (req, res) => {
    const html = await readFile(CLIENT_DIR + 'index.html', 'utf8');
    res.type('html').send(html.replace('<head>', '<head>\n<meta name="vw-api" content=".">'));
  });
  app.get(['/', '/index.html'], serveIndex);
  app.use(express.static(CLIENT_DIR, { index: false, maxAge: '1h' }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'internal error' : err.message });
  });
  return app;
}
