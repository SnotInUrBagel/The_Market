import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      name TEXT PRIMARY KEY,
      passkey TEXT,
      score INTEGER DEFAULT 0,
      collection JSONB DEFAULT '[]'::jsonb,
      trades JSONB DEFAULT '{}'::jsonb
    )
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trades JSONB DEFAULT '{}'::jsonb`);
}

export async function handler() {
  try {
    await ensureUsersTable();
    const res = await pool.query('SELECT name, passkey, score, collection, trades FROM users');
    const obj = {};
    for (const row of res.rows) {
      const key = (row.name || '').toUpperCase();
      obj[key] = {
        name: row.name,
        passkey: row.passkey,
        score: typeof row.score === 'number' ? row.score : (row.score ? Number(row.score) : 0),
        collection: row.collection || [],
        trades: row.trades || {}
      };
    }
    return {
      statusCode: 200,
      body: JSON.stringify(obj),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
