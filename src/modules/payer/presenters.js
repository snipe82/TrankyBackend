import { etiquetaTipoCuota, presentarUnidad } from '../../config/rubros.js';
import { puedePagarCuota } from '../../config/organizationUnitConfig.js';

const ESTADO_ETIQUETA = {
  PENDIENTE: 'Pendiente',
  VENCIDO: 'Vencida',
  EN_PROCESO: 'Pago en proceso',
  PAGADO: 'Pagada',
  ANULADO: 'Anulada',
};

export function resumenUnidad(unidad) {
  const { etiqueta, descripcion } = presentarUnidad(unidad.rubro, unidad.tipo_unidad, unidad.metadata_json);
  return {
    id: unidad.id,
    codigo_interno: unidad.codigo_interno,
    alias: unidad.alias,
    tipo_unidad: unidad.tipo_unidad,
    tipo_etiqueta: etiqueta,
    descripcion,
  };
}

export function presentarUnidadCompleta(unidad) {
  return {
    ...resumenUnidad(unidad),
    metadata: unidad.metadata_json,
    roles: unidad.roles,
    edificio: {
      id: unidad.organization_unit_id,
      nombre: unidad.edificio_nombre,
      direccion: unidad.edificio_direccion,
      administradora: unidad.administradora,
      moneda: unidad.moneda_base,
    },
  };
}

export function presentarCuota(debt, unidad, payerId) {
  return {
    id: debt.id,
    unidad: resumenUnidad(unidad),
    edificio: { id: unidad.organization_unit_id, nombre: unidad.edificio_nombre },
    periodo: debt.periodo,
    concepto: debt.concepto_principal,
    tipo_cuota: debt.tipo_cuota,
    tipo_cuota_etiqueta: etiquetaTipoCuota(unidad.rubro, debt.tipo_cuota),
    fecha_emision: debt.fecha_emision,
    fecha_vencimiento: debt.fecha_vencimiento,
    moneda: debt.moneda,
    monto_base: debt.monto_base,
    monto_mora: debt.monto_mora,
    monto_descuento: debt.monto_descuento,
    monto_total: debt.monto_total,
    detalle_items: debt.detalle_items_json,
    estado: debt.estado,
    estado_etiqueta: ESTADO_ETIQUETA[debt.estado] ?? debt.estado,
    puede_pagar: ['PENDIENTE', 'VENCIDO'].includes(debt.estado) && puedePagarCuota(unidad.permisos, debt, payerId),
  };
}
