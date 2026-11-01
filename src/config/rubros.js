import { z } from 'zod';
import { AppError } from '../shared/errors.js';

// Catálogo por rubro (FSD-002 §5): el vocabulario vive aquí, no en el esquema core.

const positivo = z.number().nonnegative();
const alicuota = z.number().min(0).max(100);
const join = (parts) => parts.filter(Boolean).join(' · ');

export const RUBROS = {
  INMOBILIARIO: {
    tiposUnidad: {
      DEPARTAMENTO: {
        etiqueta: 'Departamento',
        etiquetaPlural: 'Departamentos',
        orden: 1,
        metadata: z.looseObject({
          piso: z.number().int().optional(),
          numero: z.string().optional(),
          area_m2: positivo.optional(),
          alicuota: alicuota.optional(),
          dormitorios: z.number().int().nonnegative().optional(),
          unidad_principal_id: z.uuid().optional(),
        }),
        describir: (m) =>
          join([
            m.piso !== undefined && `Piso ${m.piso}`,
            m.numero && `N.° ${m.numero}`,
            m.area_m2 !== undefined && `${m.area_m2} m²`,
            m.dormitorios !== undefined && `${m.dormitorios} dorm.`,
            m.alicuota !== undefined && `Alícuota ${m.alicuota} %`,
          ]),
      },
      DEPOSITO: {
        etiqueta: 'Depósito',
        etiquetaPlural: 'Depósitos',
        orden: 2,
        metadata: z.looseObject({
          nivel: z.string().optional(),
          numero: z.string().optional(),
          area_m2: positivo.optional(),
          alicuota: alicuota.optional(),
          unidad_principal_id: z.uuid().optional(),
        }),
        describir: (m) =>
          join([
            m.numero && `N.° ${m.numero}`,
            m.nivel && `Nivel ${m.nivel}`,
            m.area_m2 !== undefined && `${m.area_m2} m²`,
            m.alicuota !== undefined && `Alícuota ${m.alicuota} %`,
          ]),
      },
      COCHERA: {
        etiqueta: 'Cochera',
        etiquetaPlural: 'Cocheras',
        orden: 3,
        metadata: z.looseObject({
          nivel: z.string().optional(),
          numero: z.string().optional(),
          techada: z.boolean().optional(),
          area_m2: positivo.optional(),
          alicuota: alicuota.optional(),
          unidad_principal_id: z.uuid().optional(),
        }),
        describir: (m) =>
          join([
            m.techada === true ? 'Cochera techada' : m.techada === false ? 'Cochera no techada' : null,
            m.numero && `N.° ${m.numero}`,
            m.nivel && `Nivel ${m.nivel}`,
            m.area_m2 !== undefined && `${m.area_m2} m²`,
            m.alicuota !== undefined && `Alícuota ${m.alicuota} %`,
          ]),
      },
    },
    tiposCuota: {
      ORDINARIA: { etiqueta: 'Ordinaria' },
      EXTRAORDINARIA: { etiqueta: 'Extraordinaria' },
    },
  },
};

export function catalogo(rubro) {
  const cat = RUBROS[rubro];
  if (!cat) throw new AppError(422, 'RUBRO_NO_SOPORTADO', `Rubro no soportado: ${rubro}`);
  return cat;
}

export function tipoUnidad(rubro, tipo) {
  const def = catalogo(rubro).tiposUnidad[tipo];
  if (!def) {
    const validos = Object.keys(catalogo(rubro).tiposUnidad).join(', ');
    throw new AppError(422, 'TIPO_UNIDAD_INVALIDO', `Tipo de unidad no reconocido: ${tipo}. Válidos: ${validos}`);
  }
  return def;
}

export function validarMetadata(rubro, tipo, metadata) {
  const result = tipoUnidad(rubro, tipo).metadata.safeParse({ ...metadata, tipo });
  if (!result.success) {
    throw new AppError(422, 'METADATA_INVALIDA', 'metadata_json no cumple el esquema del tipo de unidad', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

export function validarTipoCuota(rubro, tipo) {
  if (!catalogo(rubro).tiposCuota[tipo]) {
    const validos = Object.keys(catalogo(rubro).tiposCuota).join(', ');
    throw new AppError(422, 'TIPO_CUOTA_INVALIDO', `Tipo de cuota no reconocido: ${tipo}. Válidos: ${validos}`);
  }
}

export function presentarUnidad(rubro, tipo, metadata) {
  const def = RUBROS[rubro]?.tiposUnidad[tipo];
  return {
    etiqueta: def?.etiqueta ?? tipo,
    descripcion: def ? def.describir(metadata ?? {}) : '',
  };
}

export function grupoTipoUnidad(rubro, tipo) {
  const def = RUBROS[rubro]?.tiposUnidad[tipo];
  return { etiqueta: def?.etiquetaPlural ?? tipo, orden: def?.orden ?? 99 };
}

export function etiquetaTipoCuota(rubro, tipo) {
  return RUBROS[rubro]?.tiposCuota[tipo]?.etiqueta ?? tipo;
}
