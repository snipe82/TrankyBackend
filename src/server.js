import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { logger } from './shared/logger.js';
import { createApp } from './app.js';
import { iniciarJobs } from './jobs/index.js';

async function bootstrap() {
  await pool.query('SELECT 1');
  const detenerJobs = iniciarJobs();
  const server = createApp().listen(env.port, () => {
    logger.info({ port: env.port, env: env.nodeEnv, dev_routes: env.devRoutes }, '[api] Tranky escuchando');
  });

  const apagar = (signal) => {
    logger.info({ signal }, '[api] apagando');
    detenerJobs();
    server.close(() => pool.end().finally(() => process.exit(0)));
  };
  process.on('SIGINT', apagar);
  process.on('SIGTERM', apagar);
}

bootstrap().catch((err) => {
  logger.fatal({ err }, '[api] no pudo iniciar');
  process.exit(1);
});
