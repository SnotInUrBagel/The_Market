import pkg from 'pg';
const { Pool } = pkg;

const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
const baseHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      name TEXT PRIMARY KEY,
      passkey TEXT,
      score INTEGER DEFAULT 0,
      collection JSONB DEFAULT '[]'::jsonb
    )
  `);
}

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: baseHeaders, body: '' };
    }
    if (event.httpMethod && event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: baseHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }
    await ensureUsersTable();
    const parsed = event && event.body ? JSON.parse(event.body) : {};
    const updates = parsed.updates || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const key of Object.keys(updates)) {
        const user = updates[key] || {};
        const name = user.name || key;
        const passkey = user.passkey || null;
        const score = typeof user.score === 'number' ? user.score : (user.score ? Number(user.score) : 0);
        const collection = Array.isArray(user.collection) ? user.collection : [];
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
    return { statusCode: 200, headers: baseHeaders, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers: baseHeaders, body: JSON.stringify({ error: err.message }) };
  }
}
