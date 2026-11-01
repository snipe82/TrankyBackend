import rateLimit from 'express-rate-limit';

// RNF-05: rate limiting en login, OTP y checkout.
const handler = (message) => (_req, res) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message } });

const limiter = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    handler: handler(message),
  });

export const globalLimiter = limiter(15 * 60_000, 600, 'Demasiadas solicitudes, intenta más tarde');
export const loginLimiter = limiter(15 * 60_000, 20, 'Demasiados intentos de inicio de sesión, intenta más tarde');
export const otpLimiter = limiter(15 * 60_000, 5, 'Demasiadas solicitudes de código, intenta más tarde');
export const checkoutLimiter = limiter(60_000, 20, 'Demasiados intentos de pago, espera un momento');
export const payLinkLimiter = limiter(15 * 60_000, 60, 'Demasiadas solicitudes, intenta más tarde');
