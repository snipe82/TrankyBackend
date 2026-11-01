// Montos en céntimos enteros para evitar errores de punto flotante.

export function toCents(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Math.round(value * 100);
  const [int, dec = ''] = String(value).trim().split('.');
  const sign = int.startsWith('-') ? -1 : 1;
  const cents = Math.abs(Number(int)) * 100 + Number((dec + '00').slice(0, 2));
  return sign * cents;
}

export function fromCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// Redondeo half-up de un monto fraccionario en céntimos.
export function roundCents(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}

const formatters = new Map();
export function formatMoney(value, moneda = 'PEN') {
  if (!formatters.has(moneda)) {
    formatters.set(moneda, new Intl.NumberFormat('es-PE', { style: 'currency', currency: moneda }));
  }
  return formatters.get(moneda).format(toCents(value) / 100);
}
