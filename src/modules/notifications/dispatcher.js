import { env } from '../../config/env.js';
import { pool, withTransaction } from '../../db/pool.js';
import { logger } from '../../shared/logger.js';
import { formatMoney } from '../../shared/money.js';
import { crearPayLink } from '../payLinks/payLinks.service.js';
import { getProvider } from './providers.js';
import { PLANTILLA } from './notification.service.js';

class Omitida extends Error {}

async function renderizar(db, notificacion) {
  const p = notificacion.payload_json;
  switch (notificacion.plantilla) {
    case PLANTILLA.AVISO_COBRANZA: {
      const { rows } = await db.query(
        `SELECT d.id, d.tenant_id, d.estado, d.concepto_principal, d.periodo, d.monto_total, d.moneda, d.fecha_vencimiento,
                bu.codigo_interno, ou.nombre AS edificio
           FROM debts d
           JOIN billing_units bu ON bu.id = d.billing_unit_id
           JOIN organization_units ou ON ou.id = bu.organization_unit_id
          WHERE d.id = $1`,
        [p.debt_id]
      );
      const d = rows[0];
      if (!d || !['PENDIENTE', 'VENCIDO'].includes(d.estado)) throw new Omitida('cuota no pagable');
      const link = await crearPayLink(db, { tenantId: d.tenant_id, debtId: d.id, payerId: notificacion.payer_id });
      return `Tranky: ${d.concepto_principal} (${d.periodo}) de ${d.codigo_interno} – ${d.edificio}. Total ${formatMoney(d.monto_total, d.moneda)}, vence el ${d.fecha_vencimiento}. Paga aquí: ${link.url}`;
    }
    case PLANTILLA.RECIBO_PAGO:
      return `Tranky: recibimos tu pago ${p.codigo_operacion} por ${formatMoney(p.monto_total_cobrado, p.moneda)}. Descarga tu comprobante desde Tranky > Pagadas.`;
    case PLANTILLA.PAGO_RECHAZADO:
      return `Tranky: tu pago ${p.codigo_operacion} no se completó (${p.motivo}). Tus cuotas siguen pendientes; puedes intentarlo de nuevo.`;
    case PLANTILLA.DATO_INCORRECTO:
      return `Tranky: un residente reportó un dato incorrecto en la unidad ${p.codigo_interno} (${p.edificio}): "${p.descripcion}".`;
    default:
      throw new Error(`Plantilla desconocida: ${notificacion.plantilla}`);
  }
}

/** Procesa el outbox de notificaciones con reintentos y backoff exponencial (RF-R-13). */
export async function procesarNotificaciones({ limite = 50 } = {}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM notifications
        WHERE estado = 'PENDIENTE' AND proximo_intento_en <= NOW()
        ORDER BY proximo_intento_en
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limite]
    );

    const resultado = { enviadas: 0, reintentos: 0, fallidas: 0 };
    for (const n of rows) {
      await client.query('SAVEPOINT notif');
      try {
        const mensaje = await renderizar(client, n);
        await getProvider(n.canal).send({ canal: n.canal, destinatario: n.destinatario, mensaje });
        await client.query('RELEASE SAVEPOINT notif');
        await client.query(
          `UPDATE notifications SET estado = 'ENVIADO', enviado_en = NOW(), intentos = intentos + 1 WHERE id = $1`,
          [n.id]
        );
        resultado.enviadas++;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT notif');
        const intentos = n.intentos + 1;
        const definitiva = err instanceof Omitida || intentos >= env.notificaciones.maxIntentos;
        await client.query(
          `UPDATE notifications
              SET intentos = $2, ultimo_error = $3, estado = $4,
                  proximo_intento_en = NOW() + make_interval(secs => $5)
            WHERE id = $1`,
          [n.id, intentos, String(err.message).slice(0, 500), definitiva ? 'FALLIDO' : 'PENDIENTE', 30 * 2 ** intentos]
        );
        if (definitiva) resultado.fallidas++;
        else resultado.reintentos++;
        if (!(err instanceof Omitida)) logger.warn({ err, notification_id: n.id }, '[notificaciones] fallo de envío');
      }
    }
    return resultado;
  });
}

export async function contarPendientes() {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE estado = 'PENDIENTE'`);
  return rows[0].n;
}
