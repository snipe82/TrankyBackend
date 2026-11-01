import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError, notFound } from '../../shared/errors.js';
import { audit } from '../../shared/audit.js';
import { fromCents, toCents } from '../../shared/money.js';
import { codigoOperacion, sha256 } from '../../shared/security.js';
import { celularPeru, uuid } from '../../shared/validation.js';
import { puedePagarCuota, puedeVerCuota } from '../../config/organizationUnitConfig.js';
import { TOKEN } from '../../middleware/auth.js';
import { unidadesDelPagador } from '../payer/access.service.js';
import { gatewayParaMetodo } from '../gateways/registry.js';
import { calcularMontos } from './fees.js';
import { marcarFallido } from './paymentState.service.js';

const PAN_LIKE = /^\d{12,19}$/;

export const checkoutSchema = z
  .object({
    debt_ids: z
      .array(uuid)
      .min(1, 'Selecciona al menos una cuota')
      .max(24)
      .refine((ids) => new Set(ids).size === ids.length, 'Cuotas repetidas'),
    metodo_pago: z.enum(['YAPE', 'CARD', 'CIP']),
    yape: z
      .object({
        celular: celularPeru,
        otp: z.string().regex(/^\d{6}$/, 'El código de aprobación de Yape debe tener 6 dígitos'),
      })
      .optional(),
    card: z
      .object({
        payment_method_id: uuid.nullish(),
        token_id: z.string().min(8).max(255).nullish(),
        guardar: z.boolean().default(false),
        marca: z.string().max(30).optional(),
        ultimos_4_digitos: z.string().regex(/^\d{4}$/).optional(),
      })
      .optional(),
  })
  .superRefine((b, ctx) => {
    if (b.metodo_pago === 'YAPE' && !b.yape) {
      ctx.addIssue({ code: 'custom', path: ['yape'], message: 'Yape requiere celular y código de aprobación' });
    }
    if (b.metodo_pago === 'CARD') {
      const pm = b.card?.payment_method_id;
      const token = b.card?.token_id;
      if (Boolean(pm) === Boolean(token)) {
        ctx.addIssue({ code: 'custom', path: ['card'], message: 'Envía payment_method_id (tarjeta guardada) o token_id (tarjeta nueva)' });
      }
      if (token && PAN_LIKE.test(token)) {
        ctx.addIssue({ code: 'custom', path: ['card', 'token_id'], message: 'Envía solo el token de la pasarela, nunca el número de tarjeta' });
      }
    }
  });

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,80}$/;

const ESTADO_PAGO = { INICIADO: 'EN_PROCESO', EXITOSO: 'PAGADO', FALLIDO: 'FALLIDO', REVERSADO: 'EXTORNADO' };

function hashSolicitud(input) {
  return sha256(
    JSON.stringify({
      debt_ids: [...input.debt_ids].sort(),
      metodo_pago: input.metodo_pago,
      celular: input.yape?.celular ?? null,
      payment_method_id: input.card?.payment_method_id ?? null,
      token: input.card?.token_id ? sha256(input.card.token_id) : null,
      guardar: input.card?.guardar ?? false,
    })
  );
}

export async function presentarPago(db, tx) {
  const { rows: cuotas } = await db.query(
    `SELECT d.id, d.periodo, d.concepto_principal AS concepto, d.estado AS estado_cuota, td.monto_aplicado, bu.codigo_interno
       FROM transaction_debts td
       JOIN debts d ON d.id = td.debt_id
       JOIN billing_units bu ON bu.id = d.billing_unit_id
      WHERE td.transaction_id = $1
      ORDER BY d.fecha_vencimiento, d.id`,
    [tx.id]
  );
  const meta = tx.metadata_json ?? {};
  return {
    transaction_id: tx.id,
    codigo_operacion: tx.codigo_operacion,
    estado: ESTADO_PAGO[tx.estado],
    metodo_pago: tx.metodo_pago,
    moneda: tx.moneda,
    monto_total: tx.monto_total_cobrado,
    resumen: {
      cuotas,
      subtotal: tx.monto_deuda_cubierta,
      comision_recaudadora: tx.comision_recaudadora,
      igv_comision: tx.igv_comision,
      comision_pasarela: tx.comision_pasarela,
      comision_asumida_por: tx.comision_asumida_por,
      monto_total: tx.monto_total_cobrado,
    },
    expira_en: tx.estado === 'INICIADO' ? tx.expira_en : null,
    fecha_pago: tx.fecha_pago,
    motivo_fallo: tx.motivo_fallo,
    ...(meta.cip ? { cip: meta.cip } : {}),
    ...(meta.next_action ? { next_action: meta.next_action } : {}),
  };
}

async function replay(tx, payerId, requestHash) {
  if (tx.payer_id !== payerId) {
    throw new AppError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'Idempotency-Key en uso por otra operación');
  }
  if (tx.request_hash !== requestHash) {
    throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'Este Idempotency-Key ya se usó con otros datos; genera uno nuevo por intento');
  }
  return { status: tx.estado === 'INICIADO' ? 202 : 200, body: await presentarPago(pool, tx) };
}

async function buscarPorIdempotencia(key) {
  const { rows } = await pool.query('SELECT * FROM transactions WHERE idempotency_key = $1', [key]);
  return rows[0];
}

async function validarPayLink(auth, input) {
  if (input.debt_ids.length !== 1 || input.debt_ids[0] !== auth.debtId) {
    throw new AppError(403, 'PAY_LINK_SCOPE', 'Este link solo permite pagar la cuota asociada');
  }
  if (input.card?.payment_method_id || input.card?.guardar) {
    throw new AppError(403, 'PAY_LINK_SCOPE', 'Para usar o guardar tarjetas inicia sesión en Tranky');
  }
  const { rows } = await pool.query('SELECT usado_en, expira_en FROM pay_links WHERE id = $1', [auth.payLinkId]);
  if (!rows[0] || rows[0].usado_en || new Date(rows[0].expira_en) <= new Date()) {
    throw new AppError(410, 'PAY_LINK_EXPIRED', 'El link expiró o ya fue usado. Inicia sesión o solicita un nuevo link.');
  }
}

/**
 * RF-R-07 a RF-R-10 / flujo 8.1. Responde 202: la confirmación llega solo por webhook.
 */
export async function checkout({ auth, body, idempotencyKey, req }) {
  if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Header Idempotency-Key requerido (16–80 caracteres alfanuméricos, - o _)');
  }
  const input = checkoutSchema.parse(body);
  const payerId = auth.sub;
  const viaPayLink = auth.typ === TOKEN.PAY_LINK;
  if (viaPayLink) await validarPayLink(auth, input);

  const requestHash = hashSolicitud(input);
  const existente = await buscarPorIdempotencia(idempotencyKey);
  if (existente) return replay(existente, payerId, requestHash);

  const gateway = gatewayParaMetodo(input.metodo_pago);

  let creada;
  try {
    creada = await withTransaction(async (client) => {
      // Regla crítica 2: bloqueo pesimista en orden estable para evitar deadlocks.
      const { rows: debts } = await client.query(
        'SELECT * FROM debts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [input.debt_ids]
      );
      if (debts.length !== input.debt_ids.length) throw notFound('Cuota no encontrada', 'DEBT_NOT_FOUND');

      const unidades = await unidadesDelPagador(client, payerId, {
        unitIds: [...new Set(debts.map((d) => d.billing_unit_id))],
      });
      const unidadPorId = new Map(unidades.map((u) => [u.id, u]));

      for (const d of debts) {
        const unidad = unidadPorId.get(d.billing_unit_id);
        if (!unidad || !puedeVerCuota(unidad.permisos, d, payerId)) throw notFound('Cuota no encontrada', 'DEBT_NOT_FOUND');
        if (d.estado === 'EN_PROCESO') throw new AppError(409, 'DEBT_IN_PROCESS', 'Esta cuota tiene un pago en proceso');
        if (d.estado === 'PAGADO') throw new AppError(409, 'DEBT_ALREADY_PAID', 'Esta cuota ya fue pagada');
        if (d.estado === 'ANULADO') throw new AppError(409, 'DEBT_ANNULLED', 'Esta cuota fue anulada');
        if (!puedePagarCuota(unidad.permisos, d, payerId)) {
          throw new AppError(403, 'DEBT_NOT_PAYABLE_BY_ROLE', 'Tu rol en esta unidad no permite pagar esta cuota');
        }
      }

      const edificios = new Set(debts.map((d) => unidadPorId.get(d.billing_unit_id).organization_unit_id));
      const monedas = new Set(debts.map((d) => d.moneda));
      if (edificios.size > 1 || monedas.size > 1) {
        throw new AppError(422, 'MIXED_CHECKOUT', 'Solo puedes pagar juntas cuotas del mismo edificio y moneda');
      }
      const unidadBase = unidadPorId.get(debts[0].billing_unit_id);

      let paymentMethodId = null;
      let tokenId = input.card?.token_id ?? null;
      if (input.metodo_pago === 'CARD' && input.card.payment_method_id) {
        const { rows } = await client.query(
          'SELECT * FROM payment_methods_vault WHERE id = $1 AND payer_id = $2 AND activo',
          [input.card.payment_method_id, payerId]
        );
        const pm = rows[0];
        if (!pm) throw notFound('Tarjeta no encontrada', 'PAYMENT_METHOD_NOT_FOUND');
        if (pm.pasarela !== gateway.provider) {
          throw new AppError(422, 'PAYMENT_METHOD_GATEWAY_MISMATCH', 'La tarjeta guardada pertenece a otra pasarela');
        }
        paymentMethodId = pm.id;
        tokenId = pm.token_id;
      } else if (input.metodo_pago === 'CARD' && input.card.guardar) {
        const { rows } = await client.query(
          `INSERT INTO payment_methods_vault (payer_id, pasarela, token_id, marca, ultimos_4_digitos, es_predeterminado)
           SELECT $1, $2, $3, $4, $5, NOT EXISTS (SELECT 1 FROM payment_methods_vault WHERE payer_id = $1 AND activo)
           ON CONFLICT (pasarela, token_id) DO NOTHING
           RETURNING id`,
          [payerId, gateway.provider, tokenId, input.card.marca ?? null, input.card.ultimos_4_digitos ?? null]
        );
        paymentMethodId = rows[0]?.id ?? null;
      }

      const { rows: tenants } = await client.query('SELECT config_comision_json FROM tenants WHERE id = $1', [unidadBase.tenant_id]);
      const montos = calcularMontos({
        deudaCents: debts.reduce((acc, d) => acc + toCents(d.monto_total), 0),
        configComision: tenants[0].config_comision_json,
        gateway,
        metodo: input.metodo_pago,
        igvTasa: env.pagos.igvTasa,
      });

      const vigencia =
        input.metodo_pago === 'CIP'
          ? `make_interval(hours => ${Number(env.pagos.cipVigenciaHoras)})`
          : `make_interval(mins => ${Number(env.pagos.timeoutMinutos)})`;

      const { rows: txRows } = await client.query(
        `INSERT INTO transactions (
           codigo_operacion, tenant_id, organization_unit_id, payer_id, origen, pay_link_id, pasarela, metodo_pago,
           payment_method_id, moneda, monto_deuda_cubierta, comision_pasarela, comision_recaudadora, igv_comision,
           monto_total_cobrado, monto_neto_a_liquidar, comision_asumida_por, idempotency_key, request_hash, expira_en,
           metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW() + ${vigencia}, $20)
         RETURNING *`,
        [
          codigoOperacion(),
          unidadBase.tenant_id,
          unidadBase.organization_unit_id,
          payerId,
          viaPayLink ? 'PAY_LINK' : 'PORTAL',
          viaPayLink ? auth.payLinkId : null,
          gateway.provider,
          input.metodo_pago,
          paymentMethodId,
          debts[0].moneda,
          fromCents(montos.deudaCents),
          fromCents(montos.comisionPasarela),
          fromCents(montos.comisionRecaudadora),
          fromCents(montos.igvComision),
          fromCents(montos.montoTotalCobrado),
          fromCents(montos.montoNeto),
          montos.asume,
          idempotencyKey,
          requestHash,
          { correlation_id: req.correlationId, ...(input.yape ? { yape_celular: input.yape.celular } : {}) },
        ]
      );
      const tx = txRows[0];

      await client.query(
        `INSERT INTO transaction_debts (transaction_id, debt_id, monto_aplicado)
         SELECT $1, d.id, d.monto_total FROM debts d WHERE d.id = ANY($2::uuid[])`,
        [tx.id, input.debt_ids]
      );
      await client.query(`UPDATE debts SET estado = 'EN_PROCESO' WHERE id = ANY($1::uuid[])`, [input.debt_ids]);

      await audit(client, {
        req,
        actorTipo: auth.typ,
        actorId: payerId,
        tenantId: tx.tenant_id,
        accion: 'CHECKOUT_INICIADO',
        entidad: 'transactions',
        entidadId: tx.id,
        detalle: { debt_ids: input.debt_ids, metodo_pago: input.metodo_pago, monto_total: tx.monto_total_cobrado },
      });
      return { tx, tokenId };
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'transactions_idempotency_key_key') {
      return replay(await buscarPorIdempotencia(idempotencyKey), payerId, requestHash);
    }
    throw err;
  }

  const { tx, tokenId } = creada;
  let respuesta;
  try {
    respuesta = await gateway.createCharge({
      transactionId: tx.id,
      amountCents: toCents(tx.monto_total_cobrado),
      currency: tx.moneda,
      method: tx.metodo_pago,
      idempotencyKey,
      yape: input.yape,
      tokenId,
      description: `Tranky ${tx.codigo_operacion}`,
      expiresAt: tx.expira_en,
    });
  } catch (err) {
    // Resultado desconocido: la transacción queda INICIADO y el job de expiración la concilia con la pasarela.
    req.log.error({ err, transaction_id: tx.id }, '[checkout] la pasarela no respondió');
    return { status: 202, body: await presentarPago(pool, tx) };
  }

  if (respuesta.status === 'DECLINED') {
    await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [tx.id]);
      if (rows[0].estado === 'INICIADO') await marcarFallido(client, rows[0], respuesta.declineReason, { notificar: false });
    });
    req.log.info({ transaction_id: tx.id, pasarela: tx.pasarela, metodo: tx.metodo_pago }, '[checkout] pago rechazado');
    throw new AppError(402, 'PAYMENT_DECLINED', respuesta.declineReason, {
      transaction_id: tx.id,
      accion: 'Las cuotas fueron liberadas; reintenta con un nuevo Idempotency-Key',
    });
  }

  const extra = {
    ...(respuesta.cip ? { cip: respuesta.cip } : {}),
    ...(respuesta.nextAction ? { next_action: respuesta.nextAction } : {}),
  };
  await pool.query('UPDATE transactions SET metadata_json = metadata_json || $2 WHERE id = $1', [tx.id, extra]);
  await pool.query('UPDATE transactions SET pasarela_tx_id = $2 WHERE id = $1 AND pasarela_tx_id IS NULL', [tx.id, respuesta.chargeId]);

  const { rows } = await pool.query('SELECT * FROM transactions WHERE id = $1', [tx.id]);
  return { status: 202, body: await presentarPago(pool, rows[0]) };
}

/** GET /payments/{id}/status: polling de la PWA mientras llega el webhook. */
export async function estadoPago(auth, transactionId) {
  const { rows } = await pool.query('SELECT * FROM transactions WHERE id = $1 AND payer_id = $2', [transactionId, auth.sub]);
  if (!rows[0]) throw notFound('Pago no encontrado', 'TRANSACTION_NOT_FOUND');
  return presentarPago(pool, rows[0]);
}
