import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';
import { recalcularMora } from '../modules/debts/mora.service.js';
import { expirarIntentos } from '../modules/payments/expiration.job.js';
import { procesarNotificaciones } from '../modules/notifications/dispatcher.js';

function programar(nombre, expresion, tarea, { silencioso = false } = {}) {
  return cron.schedule(
    expresion,
    async () => {
      try {
        const resultado = await tarea();
        if (!silencioso) logger.info({ job: nombre, resultado }, '[jobs] ejecutado');
      } catch (err) {
        logger.error({ err, job: nombre }, '[jobs] error');
      }
    },
    { name: nombre, timezone: env.timezone, noOverlap: true }
  );
}

/**
 * Jobs en proceso (node-cron). Cuando se incorpore Redis + BullMQ (RNF-03) estas tareas
 * pasan a colas con reintentos sin cambiar los servicios que invocan.
 */
export function iniciarJobs() {
  const tareas = [
    programar('mora-diaria', '1 0 * * *', () => recalcularMora()), // RF-S-04: 00:01 hora de Lima
    programar('expiracion-pagos', '* * * * *', () => expirarIntentos(), { silencioso: true }),
    programar('notificaciones', '*/15 * * * * *', () => procesarNotificaciones(), { silencioso: true }),
  ];
  logger.info({ jobs: ['mora-diaria 00:01', 'expiracion-pagos 1m', 'notificaciones 15s'] }, '[jobs] programados');
  return () => tareas.forEach((t) => t.stop());
}
