import crypto from 'node:crypto';
import { logger } from '../shared/logger.js';

const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** RNF-09: correlation-id por request y log estructurado de cada respuesta. */
export function requestContext(req, res, next) {
  const incoming = req.get('x-correlation-id');
  req.correlationId = incoming && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
  res.set('X-Correlation-Id', req.correlationId);

  const idempotencyKey = req.get('idempotency-key');
  req.log = logger.child({
    correlation_id: req.correlationId,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  });

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    req.log.info(
      { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms) },
      'request'
    );
  });
  next();
}
