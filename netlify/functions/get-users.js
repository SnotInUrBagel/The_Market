import pkg from 'pg';
const { Pool } = pkg;
import { shouldUseFileStore, loadUsersFromFile } from './_shared.js';

const defaultLocalUrl = 'postgres://postgres:postgres@localhost:5432/postgres';
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || defaultLocalUrl;
const pool = new Pool({ connectionString: databaseUrl });

// Normalize legacy collection items to the canonical shape used by the client
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

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function normalizeCard(raw) {
  const rarityKey = (raw?.rarityKey || raw?.rarity || 'bronze');
  const rarityValue = typeof raw?.rarityValue === 'number'
    ? raw.rarityValue
    : (typeof raw?.value === 'number' ? raw.value : (RARITY_VALUE_MAP[rarityKey] || 1));
  return {
    id: raw?.id || genId(),
    name: raw?.name || 'Unknown',
    rarityKey,
    rarityValue,
  };
}

function normalizeUser(user, keyUpper) {
  const collection = Array.isArray(user?.collection) ? user.collection.map(normalizeCard) : [];
  // Compute score the same way as the client
  const values = collection.map(c => (typeof c.rarityValue === 'number' ? c.rarityValue : 0)).sort((a, b) => b - a);
  const score = values.length === 0 ? 0 : (values.length === 1 ? values[0] : Math.floor((values[0] + values[1]) / 2));
  return {
    name: user?.name || keyUpper,
    passkey: user?.passkey || null,
    score: typeof user?.score === 'number' ? user.score : score,
    collection,
    trades: (user?.trades && typeof user.trades === 'object') ? user.trades : {}
  };
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

export async function handler() {
  try {
    if (shouldUseFileStore()) {
      const users = await loadUsersFromFile();
      const normalized = {};
      for (const k of Object.keys(users || {})) {
        const keyUpper = (k || '').toUpperCase();
        normalized[keyUpper] = normalizeUser(users[k] || {}, keyUpper);
      }
      return { statusCode: 200, body: JSON.stringify(normalized) };
    } else {
      await ensureUsersTable();
      const res = await pool.query('SELECT name, passkey, score, collection, trades FROM users');
      const obj = {};
      for (const row of res.rows) {
        const key = (row.name || '').toUpperCase();
        const userRaw = {
          name: row.name,
          passkey: row.passkey,
          score: typeof row.score === 'number' ? row.score : (row.score ? Number(row.score) : 0),
          collection: row.collection || [],
          trades: row.trades || {}
        };
        obj[key] = normalizeUser(userRaw, key);
      }
      return {
        statusCode: 200,
        body: JSON.stringify(obj),
      };
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
