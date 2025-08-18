import pkg from 'pg';
const { Pool } = pkg;
import { shouldUseFileStore, loadUsersFromFile, createBackupFromFileUsers, appendEventToFile } from './_shared.js';

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

export async function handler(event) {
  try {
    if (event.httpMethod && event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }
    if (shouldUseFileStore()) {
      const users = await loadUsersFromFile();
      const backup = await createBackupFromFileUsers();
      await appendEventToFile('backup_created', null, { backupId: backup.id, createdAt: backup.createdAt });
      return { statusCode: 200, body: JSON.stringify({ ok: true, backupId: backup.id, createdAt: backup.createdAt, count: Object.keys(users).length }) };
    } else {
      await ensureTables();
      await ensureEventsTable();

      const res = await pool.query('SELECT name, passkey, score, collection, trades FROM users');
      const snapshot = {};
      for (const row of res.rows) {
        const key = (row.name || '').toUpperCase();
        snapshot[key] = {
          name: row.name,
          passkey: row.passkey,
          score: typeof row.score === 'number' ? row.score : (row.score ? Number(row.score) : 0),
          collection: row.collection || [],
          trades: row.trades || {}
        };
      }

      let insertRes;
      try {
        insertRes = await pool.query(
          'INSERT INTO user_backups (data) VALUES ($1::jsonb) RETURNING id, created_at',
          [JSON.stringify(snapshot)]
        );
      } catch (e) {
        // Fallback in case the existing column is JSON (not JSONB)
        insertRes = await pool.query(
          'INSERT INTO user_backups (data) VALUES ($1::json) RETURNING id, created_at',
          [JSON.stringify(snapshot)]
        );
      }

      // Emit backup event (no specific user)
      await pool.query(
        `INSERT INTO user_events (type, user_name, payload) VALUES ($1, $2, $3::jsonb)`,
        [ 'backup_created', null, JSON.stringify({ backupId: insertRes.rows[0].id, createdAt: insertRes.rows[0].created_at }) ]
      );

      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, backupId: insertRes.rows[0].id, createdAt: insertRes.rows[0].created_at, count: res.rowCount })
      };
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}