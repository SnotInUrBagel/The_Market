import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

// Returns true when no Postgres connection string is provided
export function shouldUseFileStore() {
  return !process.env.DATABASE_URL && !process.env.POSTGRES_URL && !process.env.NEON_DATABASE_URL;
}

function getDataDir() {
  const dir = path.resolve(process.cwd(), 'netlify', 'functions', '_data');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getFilePath(fileName) {
  return path.join(getDataDir(), fileName);
}

async function readJson(fileName, fallback) {
  try {
    const filePath = getFilePath(fileName);
    const buf = await fs.readFile(filePath, 'utf8');
    const text = (buf || '').trim();
    if (!text) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeJson(fileName, value) {
  const filePath = getFilePath(fileName);
  const text = JSON.stringify(value, null, 2);
  await fs.writeFile(filePath, text, 'utf8');
}

// USERS
export async function loadUsersFromFile() {
  const users = await readJson('users.json', {});
  // Ensure keys are uppercase for consistency
  const normalized = {};
  for (const key of Object.keys(users)) {
    normalized[key.toUpperCase()] = users[key] || {};
  }
  return normalized;
}

export async function saveUsersToFile(usersObj) {
  // Persist as-is (should already be uppercased keys)
  await writeJson('users.json', usersObj || {});
}

// EVENTS (for simple long-poll subscription in file mode)
export async function appendEventToFile(type, userNameUpper, payloadObj) {
  const state = await readJson('events.json', { lastId: 0, events: [] });
  const nextId = Number(state.lastId || 0) + 1;
  const event = {
    id: nextId,
    type,
    user_name: (userNameUpper || '').toUpperCase(),
    payload: payloadObj || null
  };
  state.events.push(event);
  // prevent unbounded growth
  if (state.events.length > 5000) {
    state.events = state.events.slice(-2000);
  }
  state.lastId = nextId;
  await writeJson('events.json', state);
  return event;
}

export async function getEventsSinceFromFile(sinceId, limit = 100) {
  const state = await readJson('events.json', { lastId: 0, events: [] });
  const lastId = Number(state.lastId || 0);
  const events = (state.events || []).filter(e => Number(e.id) > Number(sinceId || 0)).slice(0, limit);
  return { events, lastId };
}

// BACKUPS
export async function createBackupFromFileUsers() {
  const users = await loadUsersFromFile();
  const backupsState = await readJson('backups.json', { lastId: 0, backups: [] });
  const nextId = Number(backupsState.lastId || 0) + 1;
  const createdAt = new Date().toISOString();
  const backup = { id: nextId, createdAt, data: users };
  backupsState.backups.push(backup);
  backupsState.lastId = nextId;
  await writeJson('backups.json', backupsState);
  return backup;
}

export async function getLatestBackupFromFile() {
  const backupsState = await readJson('backups.json', { lastId: 0, backups: [] });
  if (!backupsState.backups.length) return null;
  return backupsState.backups[backupsState.backups.length - 1];
}

export async function getBackupByIdFromFile(id) {
  const backupsState = await readJson('backups.json', { lastId: 0, backups: [] });
  const numericId = Number(id);
  return backupsState.backups.find(b => Number(b.id) === numericId) || null;
}

export async function restoreBackupToFileUsers(backup) {
  const snapshot = (backup && backup.data) || {};
  await saveUsersToFile(snapshot);
  return snapshot;
}

