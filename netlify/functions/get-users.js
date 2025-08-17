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
    if (event && event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: baseHeaders, body: '' };
    }
    await ensureUsersTable();
    const res = await pool.query('SELECT name, passkey, score, collection FROM users');
    const obj = {};
    for (const row of res.rows) {
      const key = (row.name || '').toUpperCase();
      obj[key] = {
        name: row.name,
        passkey: row.passkey,
        score: typeof row.score === 'number' ? row.score : (row.score ? Number(row.score) : 0),
        collection: row.collection || []
      };
    }
    return {
      statusCode: 200,
      headers: baseHeaders,
      body: JSON.stringify(obj),
    };
  } catch (err) {
    return { statusCode: 500, headers: baseHeaders, body: JSON.stringify({ error: err.message }) };
  }
}
