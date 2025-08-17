import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

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

export async function handler(event) {
  try {
    if (event.httpMethod && event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }
    await ensureTables();

    const res = await pool.query('SELECT name, passkey, score, collection FROM users');
    const snapshot = {};
    for (const row of res.rows) {
      const key = (row.name || '').toUpperCase();
      snapshot[key] = {
        name: row.name,
        passkey: row.passkey,
        score: typeof row.score === 'number' ? row.score : (row.score ? Number(row.score) : 0),
        collection: row.collection || []
      };
    }

    const insertRes = await pool.query(
      'INSERT INTO user_backups (data) VALUES ($1::jsonb) RETURNING id, created_at',
      [JSON.stringify(snapshot)]
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, backupId: insertRes.rows[0].id, createdAt: insertRes.rows[0].created_at, count: res.rowCount })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}