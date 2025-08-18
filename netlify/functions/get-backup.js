import pkg from 'pg';
const { Pool } = pkg;
import { shouldUseFileStore, getLatestBackupFromFile, getBackupByIdFromFile } from './_shared.js';

const defaultLocalUrl = 'postgres://postgres:postgres@localhost:5432/postgres';
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || defaultLocalUrl;
const pool = new Pool({ connectionString: databaseUrl });

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
    const url = new URL(event?.rawUrl || 'http://localhost');
    const idParam = url.searchParams.get('id');

    if (shouldUseFileStore()) {
      let backup = null;
      if (idParam) backup = await getBackupByIdFromFile(Number(idParam));
      else backup = await getLatestBackupFromFile();
      if (!backup) return { statusCode: 404, body: JSON.stringify({ error: 'No backups found' }) };
      return { statusCode: 200, body: JSON.stringify({ id: backup.id, createdAt: backup.createdAt, data: backup.data }) };
    } else {
      await ensureBackupTable();

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
        body: JSON.stringify({ id: row.id, createdAt: row.created_at, data: row.data })
      };
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}