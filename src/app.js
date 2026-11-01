import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler } from './shared/errors.js';
import { requestContext } from './middleware/requestContext.js';
import { globalLimiter } from './middleware/rateLimits.js';
import authRoutes from './modules/auth/auth.routes.js';
import payerRoutes from './modules/payer/payer.routes.js';
import paymentsRoutes from './modules/payments/payments.routes.js';
import webhooksRoutes from './modules/webhooks/webhooks.routes.js';
import tenantRoutes from './modules/tenant/tenant.routes.js';
import devRoutes from './modules/dev/dev.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext);
  app.use(helmet());
  app.use(cors({ exposedHeaders: ['X-Correlation-Id'] }));
  app.use(globalLimiter);

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'tranky-api' }));

  // Antes del parser JSON: los webhooks necesitan el cuerpo crudo para validar la firma HMAC.
  app.use('/api/v1/webhooks', webhooksRoutes);

  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/payer', payerRoutes);
  app.use('/api/v1/payments', paymentsRoutes);
  app.use('/api/v1/tenant', tenantRoutes);
  if (env.devRoutes) app.use('/api/v1/dev', devRoutes);

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } }));
  app.use(errorHandler);
  return app;
}
