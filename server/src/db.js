import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://vision:vision@localhost:5432/vision_window',
  max: Number(process.env.PG_POOL_MAX || 10),
});

export const query = (text, params) => pool.query(text, params);
