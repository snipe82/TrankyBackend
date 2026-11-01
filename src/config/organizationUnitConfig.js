import { z } from 'zod';

// Reglas parametrizables por edificio (FSD-002 §14.2). Estos son los valores por defecto
// propuestos en FSD-002 §4.1 mientras se validan P-01, P-02 y P-03 con datos reales.
export const CONFIG_DEFAULT = Object.freeze({
  mora: { tipo: 'NINGUNA', valor: 0, dias_gracia: 0, tope: null },
  permisos_cuota: {
    PROPIETARIO: { ver: ['ORDINARIA', 'EXTRAORDINARIA'], pagar: ['ORDINARIA', 'EXTRAORDINARIA'], historial: 'UNIDAD' },
    INQUILINO: { ver: ['ORDINARIA'], pagar: ['ORDINARIA'], historial: 'PROPIOS' },
  },
});

const permisoRol = z.object({
  ver: z.array(z.string()).optional(),
  pagar: z.array(z.string()).optional(),
  historial: z.enum(['UNIDAD', 'PROPIOS']).optional(),
});

export const configSchema = z.object({
  mora: z
    .object({
      tipo: z.enum(['NINGUNA', 'PENALIDAD_FIJA', 'INTERES_DIARIO']),
      valor: z.number().nonnegative(),
      dias_gracia: z.number().int().nonnegative().default(0),
      tope: z.number().nonnegative().nullable().default(null),
    })
    .optional(),
  permisos_cuota: z
    .object({ PROPIETARIO: permisoRol.optional(), INQUILINO: permisoRol.optional() })
    .optional(),
});

export function resolverConfig(configJson = {}) {
  const permisos = {};
  for (const rol of Object.keys(CONFIG_DEFAULT.permisos_cuota)) {
    permisos[rol] = { ...CONFIG_DEFAULT.permisos_cuota[rol], ...(configJson.permisos_cuota?.[rol] ?? {}) };
  }
  return {
    mora: { ...CONFIG_DEFAULT.mora, ...(configJson.mora ?? {}) },
    permisos_cuota: permisos,
  };
}

/** Permisos efectivos de un pagador sobre una unidad: unión de los permisos de sus roles activos. */
export function permisosEfectivos(config, roles) {
  const ver = new Set();
  const pagar = new Set();
  let historial = 'PROPIOS';
  for (const rol of roles) {
    const p = config.permisos_cuota[rol];
    if (!p) continue;
    p.ver.forEach((t) => ver.add(t));
    p.pagar.forEach((t) => pagar.add(t));
    if (p.historial === 'UNIDAD') historial = 'UNIDAD';
  }
  return { ver, pagar, historial };
}

export function puedeVerCuota(permisos, debt, payerId) {
  if (debt.payer_id && debt.payer_id !== payerId) return false;
  return permisos.ver.has(debt.tipo_cuota);
}

export function puedePagarCuota(permisos, debt, payerId) {
  if (debt.payer_id && debt.payer_id !== payerId) return false;
  return permisos.pagar.has(debt.tipo_cuota) && permisos.ver.has(debt.tipo_cuota);
}
