import crypto from 'node:crypto';
import { PaymentGateway } from './PaymentGateway.js';
import { hmacSha256, randomDigits, timingSafeEqualHex } from '../../shared/security.js';
import { roundCents } from '../../shared/money.js';

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';

/**
 * Pasarela simulada para desarrollo y pruebas (hitos H1–H3).
 * Reglas de simulación:
 *  - Yape con OTP 000000 -> rechazado.
 *  - Tarjeta con token que empieza con "tkn_rechazo" -> rechazada; con "tkn_3ds" -> requiere 3DS.
 *  - CIP -> devuelve código de 9 dígitos y QR.
 */
export class MockGateway extends PaymentGateway {
  #charges = new Map();

  constructor({ webhookSecret, comisionFija = 0, comisionPorcentaje = 0 }) {
    super();
    this.webhookSecret = webhookSecret;
    this.comisionFijaCents = Math.round(comisionFija * 100);
    this.comisionPorcentaje = comisionPorcentaje;
  }

  get provider() {
    return 'mock';
  }

  async createCharge({ transactionId, amountCents, currency, method, idempotencyKey, yape, tokenId, expiresAt }) {
    const existing = [...this.#charges.values()].find((c) => c.idempotencyKey === idempotencyKey);
    if (existing) return existing.response;

    let response;
    if (method === 'YAPE' && yape?.otp === '000000') {
      response = { status: 'DECLINED', declineReason: 'Código de aprobación de Yape rechazado' };
    } else if (method === 'CARD' && tokenId?.startsWith('tkn_rechazo')) {
      response = { status: 'DECLINED', declineReason: 'Tarjeta rechazada por el emisor' };
    } else {
      const chargeId = `mock_chg_${crypto.randomBytes(8).toString('hex')}`;
      response = { status: 'PENDING', chargeId };
      if (method === 'CARD' && tokenId?.startsWith('tkn_3ds')) {
        response.nextAction = { type: '3DS', url: `https://mock-gateway.local/3ds/${chargeId}` };
      }
      if (method === 'CIP') {
        const codigo = randomDigits(9);
        response.cip = { codigo, qr: `MOCKQR|${codigo}|${(amountCents / 100).toFixed(2)}|${currency}`, expira_en: expiresAt };
      }
      this.#charges.set(chargeId, { transactionId, amountCents, currency, status: 'PENDING', idempotencyKey, response });
    }
    return response;
  }

  async getCharge(chargeId) {
    const charge = this.#charges.get(chargeId);
    return { status: charge ? charge.status : 'NOT_FOUND' };
  }

  async refund({ chargeId }) {
    const charge = this.#charges.get(chargeId);
    if (!charge) return { status: 'NOT_FOUND' };
    charge.status = 'REFUNDED';
    return { status: 'REFUNDED', refundId: `mock_ref_${crypto.randomBytes(6).toString('hex')}` };
  }

  estimateFee({ amountCents }) {
    return this.comisionFijaCents + roundCents(amountCents * this.comisionPorcentaje);
  }

  sign(rawBody) {
    return hmacSha256(this.webhookSecret, rawBody);
  }

  verifyWebhook(rawBody, headers) {
    const signature = headers[MOCK_SIGNATURE_HEADER];
    if (!rawBody || !signature) return false;
    return timingSafeEqualHex(signature, this.sign(rawBody));
  }

  parseWebhook(payload) {
    return {
      eventId: payload.id,
      type: payload.type,
      chargeId: payload.data?.charge_id,
      reference: payload.data?.reference,
      amountCents: payload.data?.amount,
      currency: payload.data?.currency,
      failureReason: payload.data?.failure_reason,
    };
  }

  /** Solo para el simulador de desarrollo: arma un webhook firmado como lo haría la pasarela. */
  buildWebhook({ chargeId, type, failureReason }) {
    const charge = this.#charges.get(chargeId);
    if (charge) charge.status = type === 'charge.succeeded' ? 'SUCCEEDED' : 'FAILED';
    const payload = {
      id: `mock_evt_${crypto.randomBytes(8).toString('hex')}`,
      type,
      created: Math.floor(Date.now() / 1000),
      data: {
        charge_id: chargeId,
        reference: charge?.transactionId,
        amount: charge?.amountCents,
        currency: charge?.currency,
        ...(failureReason ? { failure_reason: failureReason } : {}),
      },
    };
    const rawBody = JSON.stringify(payload);
    return { rawBody, headers: { [MOCK_SIGNATURE_HEADER]: this.sign(rawBody) } };
  }
}
