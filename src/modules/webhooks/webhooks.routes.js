import express, { Router } from 'express';
import { procesarWebhook } from './webhook.service.js';

const router = Router();

// Cuerpo crudo: la firma HMAC se calcula sobre los bytes exactos recibidos.
router.post('/gateway/:provider', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const result = await procesarWebhook({
    provider: req.params.provider.toLowerCase(),
    rawBody,
    headers: req.headers,
    log: req.log,
  });
  res.json(result);
});

export default router;
