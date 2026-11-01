import { pool } from '../../db/pool.js';
import { resolverConfig } from '../../config/organizationUnitConfig.js';
import { fromCents, roundCents, toCents } from '../../shared/money.js';

/**
 * Mora según la regla del edificio (RF-S-04, P-03). Se calcula de forma determinística a partir
 * de los días vencidos, así que ejecutar el cron dos veces el mismo día no duplica recargos.
 *  - PENALIDAD_FIJA: monto único al superar los días de gracia.
 *  - INTERES_DIARIO: valor = % diario sobre monto_base por cada día vencido después de la gracia.
 */
export function calcularMoraCents({ montoBaseCents, diasVencidos, regla }) {
  const dias = diasVencidos - (regla.dias_gracia ?? 0);
  if (regla.tipo === 'NINGUNA' || dias <= 0) return 0;
  let mora =
    regla.tipo === 'PENALIDAD_FIJA'
      ? toCents(regla.valor)
      : roundCents((montoBaseCents * Number(regla.valor) * dias) / 100);
  if (regla.tope !== null && regla.tope !== undefined) mora = Math.min(mora, toCents(regla.tope));
  return mora;
}

/**
 * PENDIENTE -> VENCIDO y recálculo de monto_mora. Las cuotas EN_PROCESO no se tocan
 * (la mora queda congelada mientras dura el intento de pago).
 */
export async function recalcularMora(db = pool, { debtIds = null } = {}) {
  const { rows } = await db.query(
    `SELECT d.id, d.estado, d.monto_base, d.monto_mora, (CURRENT_DATE - d.fecha_vencimiento) AS dias_vencidos, ou.config_json
       FROM debts d
       JOIN billing_units bu ON bu.id = d.billing_unit_id
       JOIN organization_units ou ON ou.id = bu.organization_unit_id
      WHERE d.estado IN ('PENDIENTE', 'VENCIDO')
        AND d.fecha_vencimiento < CURRENT_DATE
        AND ($1::uuid[] IS NULL OR d.id = ANY($1::uuid[]))
      FOR UPDATE OF d SKIP LOCKED`,
    [debtIds]
  );

  let actualizadas = 0;
  for (const d of rows) {
    const regla = resolverConfig(d.config_json).mora;
    const mora = calcularMoraCents({ montoBaseCents: toCents(d.monto_base), diasVencidos: d.dias_vencidos, regla });
    if (d.estado === 'VENCIDO' && toCents(d.monto_mora) === mora) continue;
    await db.query(`UPDATE debts SET estado = 'VENCIDO', monto_mora = $2 WHERE id = $1`, [d.id, fromCents(mora)]);
    actualizadas++;
  }
  return { revisadas: rows.length, actualizadas };
}
