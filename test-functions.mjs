import { handler as getUsers } from './netlify/functions/get-users.js';
import { handler as saveUsers } from './netlify/functions/save-users.js';
import { handler as subscribe } from './netlify/functions/subscribe.js';
import { handler as backup } from './netlify/functions/backup-users.js';
import { handler as getBackup } from './netlify/functions/get-backup.js';
import { handler as restore } from './netlify/functions/restore-backup.js';

function log(title, obj) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

async function run() {
  // Ensure file-based store (no DB env)
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.NEON_DATABASE_URL;

  const r1 = await getUsers();
  log('getUsers initial', { status: r1.statusCode, body: r1.body });

  const u = {
    updates: {
      ALICE: { name: 'ALICE', passkey: 'pw', score: 1, collection: [{ name: 'Max', rarity: 'emerald', value: 4 }], trades: {} },
      BOB: { name: 'BOB', passkey: 'secret', collection: [{ name: 'Johan', rarityKey: 'legendary', rarityValue: 8 }], trades: {} }
    }
  };
  const r2 = await saveUsers({ httpMethod: 'POST', body: JSON.stringify(u) });
  log('saveUsers', { status: r2.statusCode, body: r2.body });

  const r3 = await getUsers();
  log('getUsers after save', { status: r3.statusCode, body: r3.body });

  const rInit = await subscribe({ httpMethod: 'GET', rawUrl: 'http://localhost/.netlify/functions/subscribe?init=1' });
  log('subscribe init', { status: rInit.statusCode, body: rInit.body });

  const initPayload = JSON.parse(rInit.body || '{}');
  const since = initPayload.lastId || 0;
  const rSub = await subscribe({ httpMethod: 'GET', rawUrl: `http://localhost/.netlify/functions/subscribe?since=${since}` });
  log('subscribe since', { status: rSub.statusCode, body: rSub.body });

  const rB = await backup({ httpMethod: 'POST' });
  log('backup', { status: rB.statusCode, body: rB.body });

  const rGB = await getBackup({ httpMethod: 'GET', rawUrl: 'http://localhost/.netlify/functions/get-backup' });
  log('get-backup', { status: rGB.statusCode, body: rGB.body });

  const rR = await restore({ httpMethod: 'POST' });
  log('restore-backup', { status: rR.statusCode, body: rR.body });
}

run().catch(err => { console.error(err); process.exit(1); });

