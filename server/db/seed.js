// Seeds the database from the same dataset the web client bundles (client/data/jaffa-demo.json),
// so the API and the offline demo always describe the same scene.
import { readFile } from 'node:fs/promises';
import { pool } from '../src/db.js';
import { localToGeo } from '../src/geo.js';

const DATASET = process.env.DATASET || new URL('../../client/data/jaffa-demo.json', import.meta.url);
const data = JSON.parse(await readFile(DATASET, 'utf8'));
const loc = data.location;

const lineString = (pts) => `LINESTRING(${pts.map(([x, z]) => { const g = localToGeo(loc, x, z); return `${g.lng} ${g.lat}`; }).join(', ')})`;
const r = loc.radius_m || 150;
const corners = [[-r, -r], [r, -r], [r, r], [-r, r], [-r, -r]].map(([x, z]) => localToGeo(loc, x, z));
const bbox = `POLYGON((${corners.map((c) => `${c.lng} ${c.lat}`).join(', ')}))`;

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('DELETE FROM spatial_locations WHERE name = $1', [loc.name]);
  const { rows: [row] } = await client.query(
    `INSERT INTO spatial_locations (name, coordinates, bounding_box)
     VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), ST_GeomFromText($4, 4326)) RETURNING id`,
    [loc.name, loc.lng, loc.lat, bbox],
  );
  const id = row.id;
  const insertAsset = (yearStart, yearEnd, type, url, metadata) => client.query(
    `INSERT INTO historical_assets (location_id, year_start, year_end, asset_type, model_url, lod_level, metadata)
     VALUES ($1, $2, $3, $4, $5, 0, $6)`,
    [id, yearStart, yearEnd, type, url, metadata],
  );

  let assets = 0, paths = 0;
  for (const era of data.eras) {
    await insertAsset(era.year_start, era.year_end, 'terrain', `procedural://terrain/${era.key}`, {
      era: { year: era.year, key: era.key, label: era.label, label_en: era.label_en, blurb: era.blurb },
      environment: era.environment,
      location_key: loc.id,
      name_en: loc.name_en,
      radius_m: loc.radius_m,
    });
    assets++;
    for (const b of era.buildings) {
      await insertAsset(era.year_start, era.year_end, 'building', `procedural://building/${b.block}`, {
        ...b, era_year: era.year, block_geom: data.blocks[b.block],
      });
      assets++;
    }
    for (const e of era.entities) {
      const pts = typeof e.path === 'string' ? data.paths[e.path] : e.path;
      await client.query(
        `INSERT INTO entity_paths (location_id, era_year, entity_type, path_geometry, speed_mps, spawn_interval_sec)
         VALUES ($1, $2, $3, ST_GeomFromText($4, 4326), $5, $6)`,
        [id, era.year, e.entity_type, lineString(pts), e.speed_mps, e.spawn_interval_sec],
      );
      paths++;
    }
  }
  for (const lm of data.landmarks || []) {
    await insertAsset(lm.year_start, lm.year_end, 'building', `procedural://landmark/${lm.kind}`, { landmark: lm });
    assets++;
  }
  await client.query('COMMIT');
  console.log(`seeded ${loc.name_en}: location ${id}, ${assets} assets, ${paths} entity paths`);
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
  await pool.end();
}
