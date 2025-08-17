import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

export async function handler(event) {
  try {
    const { updates } = JSON.parse(event.body);
    for (const name in updates) {
      const user = updates[name];
      await pool.query(
        `INSERT INTO users (name, passkey, score, collection)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO UPDATE
         SET passkey = $2, score = $3, collection = $4`,
        [user.name, user.passkey, user.score, JSON.stringify(user.collection)]
      );
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
