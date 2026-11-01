import { withTransaction } from '../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { toCents } from '../../shared/money.js';
import { getGateway } from '../gateways/registry.js';
import { marcarExitoso, marcarFallido } from '../payments/paymentState.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fuente de verdad del pago (regla crítica 4): firma HMAC válida + idempotencia por (provider, event_id).
 */
export async function procesarWebhook({ provider, rawBody, headers, log = logger }) {
  const gateway = getGateway(provider);

  if (!gateway.verifyWebhook(rawBody, headers)) {
    log.warn({ provider, alerta: 'WEBHOOK_FIRMA_INVALIDA' }, '[webhook] firma inválida');
    throw new AppError(401, 'INVALID_SIGNATURE', 'Firma inválida');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'JSON inválido');
  }
  const event = gateway.parseWebhook(payload);
  if (!event.eventId || !event.type) throw new AppError(400, 'INVALID_EVENT', 'Evento sin id o tipo');

  return withTransaction(async (client) => {
    const { rows: inserted } = await client.query(
      `INSERT INTO webhook_events (provider, event_id, event_type, firma_valida, payload_json)
       VALUES ($1, $2, $3, TRUE, $4)
       ON CONFLICT (provider, event_id) DO NOTHING
       RETURNING id`,
      [provider, event.eventId, event.type, payload]
    );
    if (!inserted[0]) return { recibido: true, duplicado: true };
    const eventRowId = inserted[0].id;

    const cerrar = async (resultado, transactionId = null) => {
      await client.query(
        'UPDATE webhook_events SET resultado = $2, transaction_id = $3, procesado_en = NOW() WHERE id = $1',
        [eventRowId, resultado, transactionId]
      );
      return { recibido: true, resultado };
    };

    if (!['charge.succeeded', 'charge.failed'].includes(event.type)) return cerrar('IGNORADO');

    const { rows } = await client.query(
      `SELECT * FROM transactions
        WHERE pasarela = $1 AND (pasarela_tx_id = $2 OR ($3::uuid IS NOT NULL AND id = $3::uuid))
        ORDER BY (pasarela_tx_id = $2) DESC NULLS LAST
        LIMIT 1
        FOR UPDATE`,
      [provider, event.chargeId ?? null, UUID.test(event.reference ?? '') ? event.reference : null]
    );
    const tx = rows[0];
    if (!tx) {
      // Sin transacción aún (carrera con el checkout): se revierte el registro para que la pasarela reintente.
      throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Transacción no encontrada; reintentar');
    }

    if (event.type === 'charge.succeeded') {
      if (tx.estado === 'EXITOSO') return cerrar('YA_APLICADO', tx.id);
      if (tx.estado !== 'INICIADO') {
        log.error({ transaction_id: tx.id, estado: tx.estado, alerta: 'PAGO_REQUIERE_CONCILIACION' }, '[webhook] cobro exitoso sobre transacción cerrada');
        return cerrar('REQUIERE_CONCILIACION', tx.id);
      }
      if (event.amountCents !== undefined && event.amountCents !== toCents(tx.monto_total_cobrado)) {
        log.error({ transaction_id: tx.id, alerta: 'MONTO_NO_COINCIDE' }, '[webhook] monto distinto al cobrado');
        return cerrar('MONTO_NO_COINCIDE', tx.id);
      }
      await marcarExitoso(client, tx, { chargeId: event.chargeId });
      return cerrar('APLICADO', tx.id);
    }

    if (tx.estado !== 'INICIADO') return cerrar('IGNORADO', tx.id);
    await marcarFallido(client, tx, event.failureReason ?? 'Pago rechazado por la pasarela');
    return cerrar('LIBERADO', tx.id);
  });
}
