import { ZodError } from 'zod';
import { logger } from './logger.js';

export class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (message = 'Recurso no encontrado', code = 'NOT_FOUND') =>
  new AppError(404, code, message);

export function errorHandler(err, req, res, _next) {
  const log = req.log ?? logger;

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Datos inválidos',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON inválido' } });
  }

  if (err.code === '23505') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'El registro ya existe' } });
  }

  log.error({ err }, 'error no controlado');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } });
}
