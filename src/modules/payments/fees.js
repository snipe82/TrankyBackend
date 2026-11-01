import { AppError } from '../../shared/errors.js';
import { roundCents, toCents } from '../../shared/money.js';

/**
 * Montos de una operación (FSD-002 §7.1, plan de negocio §8.2). Todo en céntimos.
 *  comisión recaudadora (Y) = fijo + porcentaje × deuda, según config_comision_json del tenant
 *  IGV solo sobre Y
 *  comisión pasarela (X) = estimación del adaptador; la real se concilia en la liquidación (P-07)
 *  asume PAGADOR: cobrado = deuda + X + Y + IGV  -> neto = deuda
 *  asume TENANT:  cobrado = deuda                -> neto = deuda − (X + Y + IGV)
 */
export function calcularMontos({ deudaCents, configComision, gateway, metodo, igvTasa }) {
  const tipo = configComision?.tipo ?? 'MIXTO';
  const fijo = tipo === 'PORCENTAJE' ? 0 : toCents(configComision?.fijo ?? 0);
  const porcentaje = tipo === 'FIJO' ? 0 : Number(configComision?.porcentaje ?? 0);
  const asume = configComision?.asume === 'TENANT' ? 'TENANT' : 'PAGADOR';

  const comisionRecaudadora = fijo + roundCents(deudaCents * porcentaje);
  const igvComision = roundCents(comisionRecaudadora * igvTasa);

  let montoTotalCobrado;
  let comisionPasarela;
  if (asume === 'PAGADOR') {
    const base = deudaCents + comisionRecaudadora + igvComision;
    comisionPasarela = gateway.estimateFee({ amountCents: base, method: metodo });
    montoTotalCobrado = base + comisionPasarela;
  } else {
    montoTotalCobrado = deudaCents;
    comisionPasarela = gateway.estimateFee({ amountCents: deudaCents, method: metodo });
  }

  const montoNeto = montoTotalCobrado - (comisionPasarela + comisionRecaudadora + igvComision);
  if (montoNeto < 0) {
    throw new AppError(422, 'COMMISSION_EXCEEDS_DEBT', 'Las comisiones superan el monto de la deuda; revise la configuración de comisión');
  }

  return {
    asume,
    deudaCents,
    comisionPasarela,
    comisionRecaudadora,
    igvComision,
    montoTotalCobrado,
    montoNeto,
  };
}
