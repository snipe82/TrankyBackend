import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';

const { Pool, types } = pg;

// DATE como 'YYYY-MM-DD' (sin conversión a la zona horaria del proceso).
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  max: 20,
  idleTimeoutMillis: 30_000,
  // CURRENT_DATE y NOW() se evalúan en la zona horaria del negocio (vencimientos y mora).
  options: `-c TimeZone=${env.timezone}`,
});

pool.on('error', (err) => {
  logger.error({ err }, '[db] error inesperado en el pool');
});

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
