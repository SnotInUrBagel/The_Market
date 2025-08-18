import pkg from 'pg';
const { Pool } = pkg;
import { shouldUseFileStore, getEventsSinceFromFile } from './_shared.js';

const defaultLocalUrl = 'postgres://postgres:postgres@localhost:5432/postgres';
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || defaultLocalUrl;
const pool = new Pool({ connectionString: databaseUrl });

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

function getSinceFromEvent(event) {
  try {
    const url = new URL(event?.rawUrl || 'http://localhost');
    const sinceParam = url.searchParams.get('since');
    if (!sinceParam) return 0;
    const n = Number(sinceParam);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function handler(event) {
  try {
    if (event.httpMethod && event.httpMethod !== 'GET') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }
    const url = new URL(event?.rawUrl || 'http://localhost');
    const isInit = url.searchParams.get('init');

    if (shouldUseFileStore()) {
      if (isInit) {
        const { lastId } = await getEventsSinceFromFile(0);
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({ events: [], lastId })
        };
      }
      const since = getSinceFromEvent(event);
      const startedAt = Date.now();
      const maxWaitMs = 10000;
      const pollEveryMs = 800;
      let lastId = Number(since || 0);
      let events = [];
      while (Date.now() - startedAt < maxWaitMs) {
        const res = await getEventsSinceFromFile(lastId, 100);
        events = res.events || [];
        if ((events && events.length) || (res.lastId && Number(res.lastId) > lastId)) {
          lastId = Number(res.lastId || lastId);
          break;
        }
        await sleep(pollEveryMs);
      }
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ events, lastId })
      };
    } else {
      await ensureEventsTable();
      if (isInit) {
        const maxRes = await pool.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM user_events');
        const lastId = Number(maxRes.rows?.[0]?.max_id || 0);
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({ events: [], lastId })
        };
      }

      const since = getSinceFromEvent(event);
      const startedAt = Date.now();
      const maxWaitMs = 10000; // long-poll up to 10s
      const pollEveryMs = 800;
      let lastId = since;
      let events = [];

      while (Date.now() - startedAt < maxWaitMs) {
        const res = await pool.query(
          'SELECT id, type, user_name, payload FROM user_events WHERE id > $1 ORDER BY id ASC LIMIT 100',
          [lastId]
        );
        if (res.rows.length > 0) {
          events = res.rows.map(r => ({
            id: Number(r.id),
            type: r.type,
            user_name: (r.user_name || '').toUpperCase(),
            payload: r.payload || null
          }));
          lastId = Number(res.rows[res.rows.length - 1].id);
          break;
        }
        await sleep(pollEveryMs);
      }

      // If no events within the wait window, prime lastId to current max
      if (events.length === 0) {
        const maxRes = await pool.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM user_events');
        lastId = Number(maxRes.rows?.[0]?.max_id || lastId || 0);
      }

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ events, lastId })
      };
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

