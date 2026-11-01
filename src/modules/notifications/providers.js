import { logger } from '../../shared/logger.js';

const mask = (value) => (value.length <= 4 ? '****' : `${'*'.repeat(value.length - 4)}${value.slice(-4)}`);

/**
 * Proveedor de desarrollo: registra el mensaje en el log en lugar de enviarlo.
 * Los proveedores reales (WhatsApp Business, SMS, email) implementan la misma firma `send`.
 */
const consoleProvider = {
  name: 'console',
  async send({ canal, destinatario, mensaje }) {
    logger.info({ canal, destinatario: mask(destinatario), mensaje }, '[notificación] enviada (proveedor consola)');
    return { providerMessageId: `console-${Date.now()}` };
  },
};

const providers = { WHATSAPP: consoleProvider, SMS: consoleProvider, EMAIL: consoleProvider };

export function getProvider(canal) {
  const provider = providers[canal];
  if (!provider) throw new Error(`Canal de notificación no soportado: ${canal}`);
  return provider;
}
