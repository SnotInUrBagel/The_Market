import pkg from 'pg';
const { Pool } = pkg;
import { shouldUseFileStore, loadUsersFromFile, saveUsersToFile, appendEventToFile } from './_shared.js';

const defaultLocalUrl = 'postgres://postgres:postgres@localhost:5432/postgres';
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || defaultLocalUrl;
const pool = new Pool({ connectionString: databaseUrl });

// Normalize collection items on write so clients on any device get a consistent shape
const RARITY_VALUE_MAP = {
  bronze: 1,
  silver: 2,
  gold: 3,
  emerald: 4,
  sapphire: 5,
  diamond: 6,
  platinum: 7,
  legendary: 8,
};

function normalizeCard(raw) {
  const rarityKey = (raw?.rarityKey || raw?.rarity || 'bronze');
  const rarityValue = typeof raw?.rarityValue === 'number'
    ? raw.rarityValue
    : (typeof raw?.value === 'number' ? raw.value : (RARITY_VALUE_MAP[rarityKey] || 1));
  return {
    id: raw?.id || (Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4)),
    name: raw?.name || 'Unknown',
    rarityKey,
    rarityValue,
  };
}

function normalizeUserForWrite(user, key) {
  const name = user?.name || key;
  const passkey = user?.passkey || null;
  const collection = Array.isArray(user?.collection) ? user.collection.map(normalizeCard) : [];
  const values = collection.map(c => (typeof c.rarityValue === 'number' ? c.rarityValue : 0)).sort((a,b)=>b-a);
  const score = typeof user?.score === 'number' ? user.score : (values.length === 0 ? 0 : (values.length === 1 ? values[0] : Math.floor((values[0]+values[1])/2)));
  const trades = (user?.trades && typeof user.trades === 'object') ? user.trades : {};
  return { name, passkey, score, collection, trades };
}

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
        const user = normalizeUserForWrite(updates[key] || {}, key);
        const upper = (user.name || key || '').toUpperCase();
        users[upper] = user;
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
          const u = normalizeUserForWrite(updates[key] || {}, key);
          const { name, passkey, score, collection, trades } = u;
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