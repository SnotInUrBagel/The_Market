import pkg from 'pg';
const { Pool } = pkg;
import { shouldUseFileStore, getLatestBackupFromFile, getBackupByIdFromFile, restoreBackupToFileUsers, appendEventToFile } from './_shared.js';

const defaultLocalUrl = 'postgres://postgres:postgres@localhost:5432/postgres';
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || defaultLocalUrl;
const pool = new Pool({ connectionString: databaseUrl });

async function ensureTables() {
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_backups (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      data JSONB NOT NULL
    )
  `);
}

async function ensureEventsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_events (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      type TEXT NOT NULL,
      user_name TEXT,
      payload JSONB
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
    const idParam = getIdFromEvent(event);

    if (shouldUseFileStore()) {
      let backup = null;
      if (idParam) backup = await getBackupByIdFromFile(Number(idParam));
      else backup = await getLatestBackupFromFile();
      if (!backup) return { statusCode: 404, body: JSON.stringify({ error: 'No backups found' }) };
      await restoreBackupToFileUsers(backup);
      const users = backup.data || {};
      for (const key of Object.keys(users)) {
        const u = users[key] || {};
        const name = u.name || key;
        await appendEventToFile('user_restore', (name || key || '').toUpperCase(), { data: u, backupId: backup.id });
      }
      return { statusCode: 200, body: JSON.stringify({ ok: true, backupId: backup.id }) };
    } else {
      await ensureTables();
      await ensureEventsTable();

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
          const trades = (u.trades && typeof u.trades === 'object') ? u.trades : {};
          await client.query(
            `INSERT INTO users (name, passkey, score, collection, trades)
             VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
             ON CONFLICT (name) DO UPDATE
             SET passkey = EXCLUDED.passkey,
                 score = EXCLUDED.score,
                 collection = EXCLUDED.collection,
                 trades = EXCLUDED.trades`,
            [name, passkey, score, JSON.stringify(collection), JSON.stringify(trades)]
          );

          // Emit event per user restored
          await client.query(
            `INSERT INTO user_events (type, user_name, payload)
             VALUES ($1, $2, $3::jsonb)`,
            [
              'user_restore',
              (name || key || '').toUpperCase(),
              JSON.stringify({ data: { name, passkey, score, collection, trades }, backupId: id })
            ]
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
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}