import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { AppError, notFound } from '../../shared/errors.js';
import { uuid } from '../../shared/validation.js';
import { getGateway } from '../gateways/registry.js';
import { procesarWebhook } from '../webhooks/webhook.service.js';
import { expirarIntentos } from '../payments/expiration.job.js';
import { recalcularMora } from '../debts/mora.service.js';
import { procesarNotificaciones } from '../notifications/dispatcher.js';
import { crearPayLink } from '../payLinks/payLinks.service.js';

// Solo desarrollo (ENABLE_DEV_ROUTES): simula a la pasarela y dispara jobs a demanda.
const router = Router();

const accion = z.enum(['succeed', 'fail']);

router.post('/mock-gateway/transactions/:id/:accion', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const tipo = accion.parse(req.params.accion) === 'succeed' ? 'charge.succeeded' : 'charge.failed';

  const { rows } = await pool.query('SELECT pasarela, pasarela_tx_id FROM transactions WHERE id = $1', [id]);
  const tx = rows[0];
  if (!tx) throw notFound('Transacción no encontrada');
  if (tx.pasarela !== 'mock' || !tx.pasarela_tx_id) {
    throw new AppError(422, 'NOT_MOCK_CHARGE', 'La transacción no tiene un cargo de la pasarela mock');
  }

  const gateway = getGateway('mock');
  const { rawBody, headers } = gateway.buildWebhook({
    chargeId: tx.pasarela_tx_id,
    type: tipo,
    failureReason: tipo === 'charge.failed' ? req.body?.motivo ?? 'Rechazo simulado' : undefined,
  });
  const resultado = await procesarWebhook({ provider: 'mock', rawBody, headers, log: req.log });
  res.json({ webhook: JSON.parse(rawBody), resultado });
});

// Genera un link de pago como el que llegaría por WhatsApp (RF-R-14).
router.post('/pay-links', async (req, res) => {
  const { debt_id, payer_id } = z.object({ debt_id: uuid, payer_id: uuid }).parse(req.body);
  const { rows } = await pool.query(
    `SELECT d.tenant_id FROM debts d
       JOIN unit_payer_relations r ON r.billing_unit_id = d.billing_unit_id AND r.payer_id = $2 AND r.activo
      WHERE d.id = $1 LIMIT 1`,
    [debt_id, payer_id]
  );
  if (!rows[0]) throw notFound('El pagador no tiene relación activa con la unidad de esa cuota');
  const link = await crearPayLink(pool, { tenantId: rows[0].tenant_id, debtId: debt_id, payerId: payer_id });
  res.status(201).json({ ...link, token: link.url.split('/').pop() });
});

router.post('/jobs/:job', async (req, res) => {
  const jobs = {
    mora: () => recalcularMora(),
    expiracion: () => expirarIntentos(),
    notificaciones: () => procesarNotificaciones(),
  };
  const job = jobs[req.params.job];
  if (!job) throw notFound('Job no encontrado');
  res.json(await job());
});

export default router;
