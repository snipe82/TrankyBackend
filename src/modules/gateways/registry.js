import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors.js';
import { MockGateway } from './MockGateway.js';

const gateways = new Map([['mock', new MockGateway(env.gateways.mock)]]);

export function getGateway(provider) {
  const gateway = gateways.get(provider);
  if (!gateway) throw new AppError(404, 'GATEWAY_NOT_FOUND', `Pasarela no soportada: ${provider}`);
  return gateway;
}

export function gatewayParaMetodo(metodo) {
  return getGateway(env.pagos.pasarelaPorMetodo[metodo]);
}
