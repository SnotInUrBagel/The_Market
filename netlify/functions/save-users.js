import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  ssl: { rejectUnauthorized: false }
});

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
    if (event.httpMethod && event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
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
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
