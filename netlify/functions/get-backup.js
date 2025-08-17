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

async function ensureBackupTable() {
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
    if (event && event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: baseHeaders, body: '' };
    }
    await ensureBackupTable();

    const url = new URL(event?.rawUrl || 'http://localhost');
    const idParam = url.searchParams.get('id');

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

    const row = res.rows[0];
    return {
      statusCode: 200,
      headers: baseHeaders,
      body: JSON.stringify({ id: row.id, createdAt: row.created_at, data: row.data })
    };
  } catch (err) {
    return { statusCode: 500, headers: baseHeaders, body: JSON.stringify({ error: err.message }) };
  }
}