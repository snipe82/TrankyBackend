import { z } from 'zod';
import { withTransaction } from '../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { audit } from '../../shared/audit.js';
import { fromCents, roundCents, toCents } from '../../shared/money.js';
import { fecha, periodo, uuid } from '../../shared/validation.js';
import { validarTipoCuota } from '../../config/rubros.js';
import { permisosEfectivos, puedePagarCuota, resolverConfig } from '../../config/organizationUnitConfig.js';
import { recalcularMora } from '../debts/mora.service.js';
import { encolarParaPagador, PLANTILLA } from '../notifications/notification.service.js';
import { edificioDelTenant, rubroDelTenant } from './padron.service.js';

export const emisionSchema = z
  .object({
    organization_unit_id: uuid,
    periodo,
    concepto_principal: z.string().trim().min(3).max(255),
    tipo_cuota: z.string().trim().toUpperCase().default('ORDINARIA'),
    fecha_emision: fecha.optional(),
    fecha_vencimiento: fecha,
    modo_calculo: z.enum(['MONTO_FIJO', 'ALICUOTA']).default('MONTO_FIJO'),
    items: z
      .array(z.object({ item: z.string().trim().min(1).max(100), monto: z.number().positive() }))
      .min(1)
      .max(30),
    tipos_unidad: z.array(z.string().trim().toUpperCase()).min(1).optional(),
    billing_unit_ids: z.array(uuid).min(1).optional(),
    enviar_avisos: z.boolean().default(true),
  })
  .refine((v) => !v.fecha_emision || v.fecha_vencimiento >= v.fecha_emision, {
    path: ['fecha_vencimiento'],
    message: 'La fecha de vencimiento no puede ser anterior a la de emisión',
  });

/**
 * Detalle por unidad. MONTO_FIJO: cada unidad paga los ítems tal cual.
 * ALICUOTA: los ítems son totales del edificio y se prorratean por metadata_json.alicuota (%).
 */
function itemsParaUnidad(input, unidad) {
  if (input.modo_calculo === 'MONTO_FIJO') {
    return input.items.map((i) => ({ item: i.item, monto: Number(fromCents(toCents(i.monto))) }));
  }
  const alicuota = Number(unidad.metadata_json.alicuota);
  return input.items.map((i) => ({ item: i.item, monto: Number(fromCents(roundCents((toCents(i.monto) * alicuota) / 100))) }));
}

/** RF-S-03: emisión masiva idempotente por (unidad, periodo, concepto). */
export async function emitirCuotas(tenantId, input, req) {
  return withTransaction(async (client) => {
    const edificio = await edificioDelTenant(client, tenantId, input.organization_unit_id);
    validarTipoCuota(await rubroDelTenant(client, tenantId), input.tipo_cuota);

    const { rows: unidades } = await client.query(
      `SELECT id, codigo_interno, tipo_unidad, metadata_json FROM billing_units
        WHERE tenant_id = $1 AND organization_unit_id = $2 AND activo
          AND ($3::text[] IS NULL OR tipo_unidad = ANY($3::text[]))
          AND ($4::uuid[] IS NULL OR id = ANY($4::uuid[]))
        ORDER BY codigo_interno`,
      [tenantId, input.organization_unit_id, input.tipos_unidad ?? null, input.billing_unit_ids ?? null]
    );
    if (!unidades.length) throw new AppError(422, 'NO_UNITS', 'No hay unidades activas que cumplan el filtro');

    if (input.modo_calculo === 'ALICUOTA') {
      const sinAlicuota = unidades.filter((u) => !(Number(u.metadata_json.alicuota) > 0)).map((u) => u.codigo_interno);
      if (sinAlicuota.length) {
        throw new AppError(422, 'MISSING_ALICUOTA', 'Unidades sin alícuota registrada', { unidades: sinAlicuota });
      }
    }

    const creadas = [];
    for (const unidad of unidades) {
      const items = itemsParaUnidad(input, unidad);
      const montoBase = items.reduce((acc, i) => acc + toCents(i.monto), 0);
      const { rows } = await client.query(
        `INSERT INTO debts (tenant_id, billing_unit_id, periodo, concepto_principal, tipo_cuota, moneda, fecha_emision,
                            fecha_vencimiento, monto_base, detalle_items_json)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE), $8, $9, $10)
         ON CONFLICT (billing_unit_id, periodo, concepto_principal) DO NOTHING
         RETURNING id, billing_unit_id, tipo_cuota, payer_id`,
        [
          tenantId, unidad.id, input.periodo, input.concepto_principal, input.tipo_cuota, edificio.moneda_base,
          input.fecha_emision ?? null, input.fecha_vencimiento, fromCents(montoBase), JSON.stringify(items),
        ]
      );
      if (rows[0]) creadas.push(rows[0]);
    }

    if (creadas.length) await recalcularMora(client, { debtIds: creadas.map((d) => d.id) });

    let avisos = 0;
    if (input.enviar_avisos && creadas.length) {
      const config = resolverConfig(edificio.config_json);
      const { rows: relaciones } = await client.query(
        `SELECT billing_unit_id, payer_id, array_agg(rol) AS roles
           FROM unit_payer_relations
          WHERE tenant_id = $1 AND activo AND billing_unit_id = ANY($2::uuid[])
          GROUP BY billing_unit_id, payer_id`,
        [tenantId, creadas.map((d) => d.billing_unit_id)]
      );
      for (const debt of creadas) {
        for (const r of relaciones.filter((rel) => rel.billing_unit_id === debt.billing_unit_id)) {
          if (!puedePagarCuota(permisosEfectivos(config, r.roles), debt, r.payer_id)) continue;
          avisos += await encolarParaPagador(client, {
            payerId: r.payer_id,
            tenantId,
            plantilla: PLANTILLA.AVISO_COBRANZA,
            payload: { debt_id: debt.id },
          });
        }
      }
    }

    const resultado = {
      unidades_evaluadas: unidades.length,
      cuotas_creadas: creadas.length,
      cuotas_omitidas_por_existir: unidades.length - creadas.length,
      avisos_encolados: avisos,
    };
    await audit(client, {
      req,
      accion: 'CUOTAS_EMITIDAS',
      entidad: 'organization_units',
      entidadId: input.organization_unit_id,
      detalle: { periodo: input.periodo, concepto: input.concepto_principal, ...resultado },
    });
    return resultado;
  });
}
