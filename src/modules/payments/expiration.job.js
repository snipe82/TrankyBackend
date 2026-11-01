import { pool, withTransaction } from '../../db/pool.js';
import { logger } from '../../shared/logger.js';
import { getGateway } from '../gateways/registry.js';
import { marcarFallido } from './paymentState.service.js';

/**
 * Libera cuotas de intentos vencidos (CIP de 24 h o timeout del intento). Antes de expirar consulta
 * a la pasarela: si el cargo figura como exitoso no se expira y se espera el webhook (regla crítica 4).
 */
export async function expirarIntentos({ limite = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT id FROM transactions WHERE estado = 'INICIADO' AND expira_en < NOW() ORDER BY expira_en LIMIT $1`,
    [limite]
  );

  const resultado = { revisadas: rows.length, expiradas: 0, esperando_webhook: 0 };
  for (const { id } of rows) {
    await withTransaction(async (client) => {
      const { rows: locked } = await client.query(
        `SELECT * FROM transactions WHERE id = $1 AND estado = 'INICIADO' FOR UPDATE SKIP LOCKED`,
        [id]
      );
      const tx = locked[0];
      if (!tx) return;

      if (tx.pasarela_tx_id) {
        const { status } = await getGateway(tx.pasarela).getCharge(tx.pasarela_tx_id);
        if (status === 'SUCCEEDED') {
          resultado.esperando_webhook++;
          logger.warn({ transaction_id: tx.id, alerta: 'PAGO_SIN_WEBHOOK' }, '[pagos] cargo exitoso en pasarela sin webhook');
          return;
        }
      }
      await marcarFallido(client, tx, tx.metodo_pago === 'CIP' ? 'Código CIP expirado' : 'Tiempo de pago agotado');
      resultado.expiradas++;
    }).catch((err) => logger.error({ err, transaction_id: id }, '[pagos] error al expirar intento'));
  }
  return resultado;
}
