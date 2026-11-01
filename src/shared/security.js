import crypto from 'node:crypto';

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const hmacSha256 = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('hex');

export function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const randomDigits = (length) =>
  Array.from({ length }, () => crypto.randomInt(0, 10)).join('');

export function codigoOperacion() {
  const fecha = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `TRK-${fecha}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}
