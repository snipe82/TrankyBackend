/**
 * Regla crítica 7 (FSD-002 §12): toda pasarela (Culqi, Niubiz, Izipay, Yape) implementa esta interfaz.
 * Agregar una pasarela = nuevo adaptador + registro en registry.js; el core no cambia.
 *
 * Contratos:
 *  createCharge({ transactionId, amountCents, currency, method, idempotencyKey, yape, tokenId, description, expiresAt })
 *    -> { status: 'PENDING' | 'DECLINED', chargeId?, declineReason?, nextAction?, cip? }
 *  getCharge(chargeId) -> { status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'NOT_FOUND' }
 *  refund({ chargeId, amountCents, idempotencyKey }) -> { status, refundId }
 *  estimateFee({ amountCents, method }) -> céntimos
 *  verifyWebhook(rawBody, headers) -> boolean
 *  parseWebhook(payload) -> { eventId, type, chargeId, reference, amountCents, currency, failureReason }
 *    type normalizado: 'charge.succeeded' | 'charge.failed' | otro (se registra e ignora)
 */
export class PaymentGateway {
  get provider() {
    throw new Error('provider no implementado');
  }

  async createCharge() {
    throw new Error('createCharge no implementado');
  }

  async getCharge() {
    throw new Error('getCharge no implementado');
  }

  async refund() {
    throw new Error('refund no implementado');
  }

  estimateFee() {
    throw new Error('estimateFee no implementado');
  }

  verifyWebhook() {
    throw new Error('verifyWebhook no implementado');
  }

  parseWebhook() {
    throw new Error('parseWebhook no implementado');
  }
}
