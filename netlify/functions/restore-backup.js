import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  ssl: { rejectUnauthorized: false }
});

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      name TEXT PRIMARY KEY,
      passkey TEXT,
      score INTEGER DEFAULT 0,
      collection JSONB DEFAULT '[]'::jsonb
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_backups (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      data JSONB NOT NULL
    )
  `);
}

function getIdFromEvent(event) {
  const qpId = event?.queryStringParameters?.id;
  if (qpId) return qpId;
  try {
    const url = new URL(event?.rawUrl || 'http://localhost');
    return url.searchParams.get('id');
  } catch {
    return null;
  }
}

export async function handler(event) {
  try {
    if (event.httpMethod && event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }
    await ensureTables();

    const idParam = getIdFromEvent(event);
    let query = 'SELECT id, created_at, data FROM user_backups ORDER BY created_at DESC LIMIT 1';
    let params = [];
    if (idParam) {
      query = 'SELECT id, created_at, data FROM user_backups WHERE id = $1';
      params = [Number(idParam)];
    }

    const res = await pool.query(query, params);
    if (!res.rows.length) {
      return { statusCode: 404, body: JSON.stringify({ error: 'No backups found' }) };
    }

    const { id, data } = res.rows[0];
    const snapshot = data || {};

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE TABLE users');
      for (const key of Object.keys(snapshot)) {
        const u = snapshot[key] || {};
        const name = u.name || key;
        const passkey = u.passkey || null;
        const score = typeof u.score === 'number' ? u.score : (u.score ? Number(u.score) : 0);
        const collection = Array.isArray(u.collection) ? u.collection : [];
        await client.query(
          `INSERT INTO users (name, passkey, score, collection)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (name) DO UPDATE
           SET passkey = EXCLUDED.passkey,
               score = EXCLUDED.score,
               collection = EXCLUDED.collection`,
          [name, passkey, score, JSON.stringify(collection)]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, backupId: id }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}