import { z } from 'zod';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError, notFound } from '../../shared/errors.js';
import { audit } from '../../shared/audit.js';
import { getGateway } from '../gateways/registry.js';

const PAN_LIKE = /^\d{12,19}$/;

// Regla crítica 5: solo token de la pasarela, marca y últimos 4 dígitos.
export const nuevoMedioSchema = z.object({
  pasarela: z.string().trim().toLowerCase().default('mock'),
  token_id: z
    .string()
    .min(8)
    .max(255)
    .refine((t) => !PAN_LIKE.test(t), 'Envía solo el token de la pasarela, nunca el número de tarjeta'),
  marca: z.string().max(30).optional(),
  ultimos_4_digitos: z.string().regex(/^\d{4}$/, 'Deben ser 4 dígitos'),
  es_predeterminado: z.boolean().default(false),
  debito_automatico_activo: z.boolean().default(false),
});

export const actualizarMedioSchema = z
  .object({ es_predeterminado: z.literal(true).optional(), debito_automatico_activo: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nada que actualizar');

const COLUMNAS = `id, pasarela, tipo, marca, ultimos_4_digitos, es_predeterminado, debito_automatico_activo, created_at`;

export async function listarMedios(payerId) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS} FROM payment_methods_vault WHERE payer_id = $1 AND activo ORDER BY es_predeterminado DESC, created_at DESC`,
    [payerId]
  );
  return rows;
}

export async function agregarMedio(payerId, input, req) {
  getGateway(input.pasarela);
  return withTransaction(async (client) => {
    const { rows: existentes } = await client.query(
      'SELECT count(*)::int AS n FROM payment_methods_vault WHERE payer_id = $1 AND activo',
      [payerId]
    );
    const predeterminado = input.es_predeterminado || existentes[0].n === 0;
    if (predeterminado) {
      await client.query('UPDATE payment_methods_vault SET es_predeterminado = FALSE WHERE payer_id = $1 AND activo', [payerId]);
    }
    const { rows } = await client.query(
      `INSERT INTO payment_methods_vault (payer_id, pasarela, token_id, marca, ultimos_4_digitos, es_predeterminado, debito_automatico_activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (pasarela, token_id) DO NOTHING
       RETURNING ${COLUMNAS}`,
      [payerId, input.pasarela, input.token_id, input.marca ?? null, input.ultimos_4_digitos, predeterminado, input.debito_automatico_activo]
    );
    if (!rows[0]) throw new AppError(409, 'PAYMENT_METHOD_EXISTS', 'La tarjeta ya está registrada');
    await audit(client, { req, accion: 'MEDIO_PAGO_AGREGADO', entidad: 'payment_methods_vault', entidadId: rows[0].id });
    return rows[0];
  });
}

export async function actualizarMedio(payerId, id, input, req) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id FROM payment_methods_vault WHERE id = $1 AND payer_id = $2 AND activo FOR UPDATE',
      [id, payerId]
    );
    if (!rows[0]) throw notFound('Tarjeta no encontrada', 'PAYMENT_METHOD_NOT_FOUND');
    if (input.es_predeterminado) {
      await client.query('UPDATE payment_methods_vault SET es_predeterminado = FALSE WHERE payer_id = $1 AND activo', [payerId]);
    }
    const { rows: updated } = await client.query(
      `UPDATE payment_methods_vault
          SET es_predeterminado = COALESCE($2, es_predeterminado),
              debito_automatico_activo = COALESCE($3, debito_automatico_activo)
        WHERE id = $1
        RETURNING ${COLUMNAS}`,
      [id, input.es_predeterminado ?? null, input.debito_automatico_activo ?? null]
    );
    await audit(client, { req, accion: 'MEDIO_PAGO_ACTUALIZADO', entidad: 'payment_methods_vault', entidadId: id, detalle: input });
    return updated[0];
  });
}

/** RF-R-11: baja lógica; si tiene débito automático activo exige confirmar. */
export async function eliminarMedio(payerId, id, { confirmar }, req) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM payment_methods_vault WHERE id = $1 AND payer_id = $2 AND activo FOR UPDATE',
      [id, payerId]
    );
    const medio = rows[0];
    if (!medio) throw notFound('Tarjeta no encontrada', 'PAYMENT_METHOD_NOT_FOUND');
    if (medio.debito_automatico_activo && !confirmar) {
      throw new AppError(409, 'CONFIRMATION_REQUIRED', 'La tarjeta tiene débito automático activo. Confirma para desvincularla (?confirmar=true).');
    }
    await client.query(
      `UPDATE payment_methods_vault
          SET activo = FALSE, es_predeterminado = FALSE, debito_automatico_activo = FALSE, desactivado_en = NOW()
        WHERE id = $1`,
      [id]
    );
    await audit(client, {
      req,
      accion: 'MEDIO_PAGO_ELIMINADO',
      entidad: 'payment_methods_vault',
      entidadId: id,
      detalle: { debito_automatico_desactivado: medio.debito_automatico_activo },
    });
    return { id, eliminado: true, debito_automatico_desactivado: medio.debito_automatico_activo };
  });
}
