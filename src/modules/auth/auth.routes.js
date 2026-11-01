import { Router } from 'express';
import { z } from 'zod';
import { documento, email } from '../../shared/validation.js';
import { loginLimiter, otpLimiter } from '../../middleware/rateLimits.js';
import { loginAdministrador, loginPagador, solicitarOtp } from './auth.service.js';

const router = Router();

const loginSchema = documento
  .and(
    z.object({
      password: z.string().min(1).max(200).optional(),
      otp: z.string().regex(/^\d{6}$/, 'El código debe tener 6 dígitos').optional(),
    })
  )
  .refine((v) => (v.password === undefined) !== (v.otp === undefined), 'Envía password u otp (no ambos)');

const otpSchema = documento.and(z.object({ canal: z.enum(['WHATSAPP', 'SMS']).default('WHATSAPP') }));

const adminLoginSchema = z.object({ email, password: z.string().min(1).max(200) });

router.post('/login', loginLimiter, async (req, res) => {
  res.json(await loginPagador(loginSchema.parse(req.body), req));
});

router.post('/otp', otpLimiter, async (req, res) => {
  res.status(202).json(await solicitarOtp(otpSchema.parse(req.body), req));
});

router.post('/admin/login', loginLimiter, async (req, res) => {
  res.json(await loginAdministrador(adminLoginSchema.parse(req.body), req));
});

export default router;
