import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../shared/errors.js';

export const TOKEN = Object.freeze({
  PAYER: 'PAYER',
  TENANT_ADMIN: 'TENANT_ADMIN',
  PAY_LINK: 'PAY_LINK',
});

const ISSUER = 'tranky-api';

export function signPayerToken(payerId) {
  return jwt.sign({ typ: TOKEN.PAYER }, env.jwtSecret, { subject: payerId, expiresIn: env.jwtExpiresIn, issuer: ISSUER });
}

export function signAdminToken(admin) {
  return jwt.sign({ typ: TOKEN.TENANT_ADMIN, tid: admin.tenant_id }, env.jwtSecret, {
    subject: admin.id,
    expiresIn: env.jwtExpiresIn,
    issuer: ISSUER,
  });
}

/** Token acotado a una sola cuota, emitido al resolver un link de pago (RF-R-14). */
export function signPayLinkToken({ payLinkId, payerId, debtId }) {
  return jwt.sign({ typ: TOKEN.PAY_LINK, plid: payLinkId, did: debtId }, env.jwtSecret, {
    subject: payerId,
    expiresIn: `${env.payLinks.checkoutTtlMinutos}m`,
    issuer: ISSUER,
  });
}

export function authenticate(...allowed) {
  return (req, _res, next) => {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Token requerido'));
    }
    let claims;
    try {
      claims = jwt.verify(header.slice(7), env.jwtSecret, { issuer: ISSUER });
    } catch {
      return next(new AppError(401, 'UNAUTHORIZED', 'Token inválido o expirado'));
    }
    if (!allowed.includes(claims.typ)) {
      return next(new AppError(403, 'FORBIDDEN', 'Acceso denegado'));
    }
    req.auth = {
      typ: claims.typ,
      sub: claims.sub,
      tenantId: claims.tid ?? null,
      payLinkId: claims.plid ?? null,
      debtId: claims.did ?? null,
    };
    req.log = req.log.child({ actor_tipo: claims.typ, actor_id: claims.sub });
    next();
  };
}
