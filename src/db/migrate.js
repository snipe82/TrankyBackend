import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { isMainModule } from '../shared/isMain.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');
const MIGRATION_LOCK_ID = 727_001;

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
      if (rowCount) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        console.log(`[migrate] aplicada ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`[migrate] falló ${file}: ${err.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    client.release();
  }
}

if (isMainModule(import.meta.url)) {
  migrate()
    .then(() => console.log('[migrate] esquema al día'))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
