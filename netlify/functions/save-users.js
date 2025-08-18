import pkg from 'pg';
const { Pool } = pkg;
import { shouldUseFileStore, loadUsersFromFile, saveUsersToFile, appendEventToFile } from './_shared.js';

const defaultLocalUrl = 'postgres://postgres:postgres@localhost:5432/postgres';
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || defaultLocalUrl;
const pool = new Pool({ connectionString: databaseUrl });

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
    const parsed = event && event.body ? JSON.parse(event.body) : {};
    const updates = parsed.updates || {};

    if (shouldUseFileStore()) {
      const users = await loadUsersFromFile();
      for (const key of Object.keys(updates)) {
        const user = updates[key] || {};
        const name = user.name || key;
        const passkey = user.passkey || null;
        const score = typeof user.score === 'number' ? user.score : (user.score ? Number(user.score) : 0);
        const collection = Array.isArray(user.collection) ? user.collection : [];
        const trades = (user.trades && typeof user.trades === 'object') ? user.trades : {};
        const upper = (name || key || '').toUpperCase();
        users[upper] = { name, passkey, score, collection, trades };
        await appendEventToFile('user_update', upper, { data: users[upper] });
      }
      await saveUsersToFile(users);
      return { statusCode: 200, body: JSON.stringify({ ok: true, db: users }) };
    } else {
      await ensureUsersTable();
      await ensureEventsTable();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const key of Object.keys(updates)) {
          const user = updates[key] || {};
          const name = user.name || key;
          const passkey = user.passkey || null;
          const score = typeof user.score === 'number' ? user.score : (user.score ? Number(user.score) : 0);
          const collection = Array.isArray(user.collection) ? user.collection : [];
          const trades = (user.trades && typeof user.trades === 'object') ? user.trades : {};
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

          // Emit realtime event for this user update
          await client.query(
            `INSERT INTO user_events (type, user_name, payload)
             VALUES ($1, $2, $3::jsonb)`,
            [
              'user_update',
              (name || key || '').toUpperCase(),
              JSON.stringify({ data: { name, passkey, score, collection, trades } })
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
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
