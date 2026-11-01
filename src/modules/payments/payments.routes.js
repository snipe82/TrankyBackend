import { Router } from 'express';
import { authenticate, TOKEN } from '../../middleware/auth.js';
import { checkoutLimiter } from '../../middleware/rateLimits.js';
import { uuid } from '../../shared/validation.js';
import { checkout, estadoPago } from './checkout.service.js';

const router = Router();

router.post('/checkout', checkoutLimiter, authenticate(TOKEN.PAYER, TOKEN.PAY_LINK), async (req, res) => {
  const { status, body } = await checkout({
    auth: req.auth,
    body: req.body,
    idempotencyKey: req.get('idempotency-key'),
    req,
  });
  res.status(status).json(body);
});

router.get('/:id/status', authenticate(TOKEN.PAYER, TOKEN.PAY_LINK), async (req, res) => {
  res.json(await estadoPago(req.auth, uuid.parse(req.params.id)));
});

export default router;
