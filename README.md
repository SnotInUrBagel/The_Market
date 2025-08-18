# The Market

Sign in works across devices and browsers using Netlify Functions. By default, a file-based store is used unless a valid Postgres `DATABASE_URL` is configured in the Netlify environment.

Notes:
- To use Postgres in production (for global persistence), set `DATABASE_URL` (or `POSTGRES_URL`/`NEON_DATABASE_URL`) to a valid connection string in Netlify site settings. The placeholder value in `netlify.toml` is ignored.
- The server normalizes user data, so collections always use `{ id, name, rarityKey, rarityValue }` shape. Legacy entries with `{ rarity, value }` are accepted and normalized.