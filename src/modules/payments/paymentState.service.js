import { logger } from '../../shared/logger.js';
import { recalcularMora } from '../debts/mora.service.js';
import { encolarParaPagador, PLANTILLA } from '../notifications/notification.service.js';

/**
 * Transiciones del pago (FSD-002 §9.1). Se ejecutan dentro de la transacción de BD del llamador,
 * con la fila de `transactions` ya bloqueada (FOR UPDATE).
 */

/** EN_PROCESO -> PENDIENTE / VENCIDO según la fecha de vencimiento, y recálculo de mora. */
export async function liberarCuotas(client, transactionId) {
  const { rows } = await client.query(
    `UPDATE debts d
        SET estado = CASE WHEN d.fecha_vencimiento < CURRENT_DATE THEN 'VENCIDO' ELSE 'PENDIENTE' END
       FROM transaction_debts td
      WHERE td.transaction_id = $1 AND td.debt_id = d.id AND d.estado = 'EN_PROCESO'
      RETURNING d.id`,
    [transactionId]
  );
  const debtIds = rows.map((r) => r.id);
  if (debtIds.length) await recalcularMora(client, { debtIds });
  return debtIds;
}

export async function marcarFallido(client, tx, motivo, { notificar = true } = {}) {
  await client.query(`UPDATE transactions SET estado = 'FALLIDO', motivo_fallo = $2 WHERE id = $1 AND estado = 'INICIADO'`, [
    tx.id,
    motivo.slice(0, 255),
  ]);
  const liberadas = await liberarCuotas(client, tx.id);
  if (notificar) {
    await encolarParaPagador(client, {
      payerId: tx.payer_id,
      tenantId: tx.tenant_id,
      plantilla: PLANTILLA.PAGO_RECHAZADO,
      payload: { transaction_id: tx.id, codigo_operacion: tx.codigo_operacion, motivo },
    });
  }
  return liberadas;
}

/** Solo se invoca tras un webhook con firma HMAC válida (regla crítica 4). */
export async function marcarExitoso(client, tx, { chargeId }) {
  await client.query(
    `UPDATE transactions
        SET estado = 'EXITOSO', fecha_pago = NOW(), pasarela_tx_id = COALESCE(pasarela_tx_id, $2)
      WHERE id = $1 AND estado = 'INICIADO'`,
    [tx.id, chargeId ?? null]
  );
  const { rows } = await client.query(
    `UPDATE debts d SET estado = 'PAGADO'
       FROM transaction_debts td
      WHERE td.transaction_id = $1 AND td.debt_id = d.id AND d.estado = 'EN_PROCESO'
      RETURNING d.id`,
    [tx.id]
  );
  const { rows: total } = await client.query('SELECT count(*)::int AS n FROM transaction_debts WHERE transaction_id = $1', [tx.id]);
  if (rows.length !== total[0].n) {
    logger.error({ transaction_id: tx.id, pagadas: rows.length, esperadas: total[0].n }, '[pagos] cuotas fuera de EN_PROCESO al confirmar pago');
  }

  if (tx.pay_link_id) {
    await client.query('UPDATE pay_links SET usado_en = NOW() WHERE id = $1 AND usado_en IS NULL', [tx.pay_link_id]);
  }

  await encolarParaPagador(client, {
    payerId: tx.payer_id,
    tenantId: tx.tenant_id,
    plantilla: PLANTILLA.RECIBO_PAGO,
    payload: {
      transaction_id: tx.id,
      codigo_operacion: tx.codigo_operacion,
      monto_total_cobrado: tx.monto_total_cobrado,
      moneda: tx.moneda,
    },
  });
  return rows.map((r) => r.id);
}
