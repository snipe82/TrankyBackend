import { env } from '../config/env.js';
import { pool } from './pool.js';
import { isMainModule } from '../shared/isMain.js';

// Borra todo el esquema de tranky_db (los triggers del ledger impiden vaciar tablas una por una).
export async function resetSchema() {
  if (env.isProduction) throw new Error('[reset] prohibido en producción');
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

if (isMainModule(import.meta.url)) {
  resetSchema()
    .then(() => console.log('[reset] esquema public recreado'))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
