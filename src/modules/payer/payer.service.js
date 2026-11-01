import { pool } from '../../db/pool.js';
import { notFound } from '../../shared/errors.js';
import { audit } from '../../shared/audit.js';
import { fromCents, toCents } from '../../shared/money.js';
import { grupoTipoUnidad } from '../../config/rubros.js';
import { puedeVerCuota } from '../../config/organizationUnitConfig.js';
import { encolarParaAdministradores, PLANTILLA } from '../notifications/notification.service.js';
import { unidadDelPagador, unidadesDelPagador } from './access.service.js';
import { presentarCuota, presentarUnidadCompleta, resumenUnidad } from './presenters.js';

const ESTADOS_ABIERTOS = ['PENDIENTE', 'VENCIDO', 'EN_PROCESO'];

/** Agrupa unidades por edificio y luego por tipo (RF-R-02, RF-R-04). */
function agruparPorEdificio(unidades, mapUnidad) {
  const edificios = new Map();
  for (const u of unidades) {
    if (!edificios.has(u.organization_unit_id)) {
      edificios.set(u.organization_unit_id, {
        id: u.organization_unit_id,
        nombre: u.edificio_nombre,
        direccion: u.edificio_direccion,
        administradora: u.administradora,
        moneda: u.moneda_base,
        tipos: new Map(),
      });
    }
    const edificio = edificios.get(u.organization_unit_id);
    if (!edificio.tipos.has(u.tipo_unidad)) {
      const grupo = grupoTipoUnidad(u.rubro, u.tipo_unidad);
      edificio.tipos.set(u.tipo_unidad, { tipo_unidad: u.tipo_unidad, etiqueta: grupo.etiqueta, orden: grupo.orden, unidades: [] });
    }
    edificio.tipos.get(u.tipo_unidad).unidades.push(mapUnidad(u));
  }
  return [...edificios.values()].map((e) => ({
    ...e,
    tipos: [...e.tipos.values()].sort((a, b) => a.orden - b.orden).map(({ orden, ...t }) => t),
  }));
}

async function cuotasVisibles(payerId, unidades, estados) {
  if (!unidades.length) return [];
  const porId = new Map(unidades.map((u) => [u.id, u]));
  const { rows } = await pool.query(
    `SELECT * FROM debts
      WHERE billing_unit_id = ANY($1::uuid[]) AND estado = ANY($2::text[])
      ORDER BY fecha_vencimiento, periodo, created_at`,
    [[...porId.keys()], estados]
  );
  return rows
    .filter((d) => puedeVerCuota(porId.get(d.billing_unit_id).permisos, d, payerId))
    .map((d) => ({ debt: d, unidad: porId.get(d.billing_unit_id) }));
}

export async function listarUnidades(payerId) {
  const unidades = await unidadesDelPagador(pool, payerId);
  return {
    total_unidades: unidades.length,
    seleccion_requerida: unidades.length > 1,
    edificios: agruparPorEdificio(unidades, (u) => ({ ...resumenUnidad(u), metadata: u.metadata_json, roles: u.roles })),
  };
}

function estadoCuenta(items) {
  const cuentas = new Map();
  for (const { debt } of items) {
    const c = cuentas.get(debt.moneda) ?? { moneda: debt.moneda, pendiente: 0, vencido: 0, en_proceso: 0 };
    const monto = toCents(debt.monto_total);
    if (debt.estado === 'PENDIENTE') c.pendiente += monto;
    if (debt.estado === 'VENCIDO') c.vencido += monto;
    if (debt.estado === 'EN_PROCESO') c.en_proceso += monto;
    cuentas.set(debt.moneda, c);
  }
  return cuentas;
}

const presentarCuenta = (c) => ({
  moneda: c.moneda,
  saldo_pendiente: fromCents(c.pendiente),
  saldo_vencido: fromCents(c.vencido),
  deuda_total: fromCents(c.pendiente + c.vencido),
  pago_en_proceso: fromCents(c.en_proceso),
});

function acumular(destino, origen) {
  for (const [moneda, c] of origen) {
    const d = destino.get(moneda) ?? { moneda, pendiente: 0, vencido: 0, en_proceso: 0 };
    d.pendiente += c.pendiente;
    d.vencido += c.vencido;
    d.en_proceso += c.en_proceso;
    destino.set(moneda, d);
  }
}

/** Unidades cuyo historial completo ve el pagador vs. solo sus propios pagos (P-01). */
function alcanceHistorial(unidades) {
  return {
    unidadCompleta: unidades.filter((u) => u.permisos.historial === 'UNIDAD').map((u) => u.id),
    soloPropios: unidades.filter((u) => u.permisos.historial !== 'UNIDAD').map((u) => u.id),
  };
}

/** RF-R-04 / GET /payer/properties: edificios -> tipos -> unidades con saldos y totales. */
export async function misPropiedades(payerId) {
  const unidades = await unidadesDelPagador(pool, payerId);
  const cuotas = await cuotasVisibles(payerId, unidades, ESTADOS_ABIERTOS);
  const alcance = alcanceHistorial(unidades);

  const { rows: ultimos } = unidades.length
    ? await pool.query(
        `SELECT DISTINCT ON (d.billing_unit_id) d.billing_unit_id, t.fecha_pago, t.codigo_operacion,
                SUM(td.monto_aplicado) OVER (PARTITION BY d.billing_unit_id, t.id) AS monto
           FROM transactions t
           JOIN transaction_debts td ON td.transaction_id = t.id
           JOIN debts d ON d.id = td.debt_id
          WHERE t.estado = 'EXITOSO' AND t.tipo_asiento = 'CARGO'
            AND (d.billing_unit_id = ANY($1::uuid[]) OR (d.billing_unit_id = ANY($2::uuid[]) AND t.payer_id = $3))
          ORDER BY d.billing_unit_id, t.fecha_pago DESC`,
        [alcance.unidadCompleta, alcance.soloPropios, payerId]
      )
    : { rows: [] };
  const ultimoPorUnidad = new Map(ultimos.map((r) => [r.billing_unit_id, r]));

  const cuentasPorUnidad = new Map();
  for (const u of unidades) {
    cuentasPorUnidad.set(u.id, estadoCuenta(cuotas.filter((c) => c.unidad.id === u.id)));
  }

  const edificios = agruparPorEdificio(unidades, (u) => {
    const ultimo = ultimoPorUnidad.get(u.id);
    const { edificio, ...datos } = presentarUnidadCompleta(u);
    return {
      ...datos,
      estado_cuenta: [...cuentasPorUnidad.get(u.id).values()].map(presentarCuenta),
      ultimo_pago: ultimo ? { fecha: ultimo.fecha_pago, monto: ultimo.monto, codigo_operacion: ultimo.codigo_operacion } : null,
    };
  });

  const general = new Map();
  for (const e of edificios) {
    const subtotal = new Map();
    for (const t of e.tipos) for (const u of t.unidades) acumular(subtotal, cuentasPorUnidad.get(u.id));
    e.subtotal = [...subtotal.values()].map(presentarCuenta);
    acumular(general, subtotal);
  }

  return { edificios, total_general: [...general.values()].map(presentarCuenta) };
}

/** RF-R-03: dashboard consolidado o filtrado por unidad. */
export async function dashboardDeuda(payerId, { unitId } = {}) {
  const unidades = unitId ? [await unidadDelPagador(pool, payerId, unitId)] : await unidadesDelPagador(pool, payerId);
  const cuotas = await cuotasVisibles(payerId, unidades, ESTADOS_ABIERTOS);

  const pagables = cuotas.filter((c) => c.debt.estado !== 'EN_PROCESO');
  const proximo = new Map();
  for (const { debt } of cuotas) {
    if (debt.estado === 'PENDIENTE' && !proximo.has(debt.moneda)) proximo.set(debt.moneda, debt);
  }

  const resumen = [...estadoCuenta(cuotas).values()].map((c) => {
    const p = proximo.get(c.moneda);
    return {
      ...presentarCuenta(c),
      proximo_vencimiento: p ? { fecha: p.fecha_vencimiento, monto: p.monto_total, debt_id: p.id } : null,
    };
  });

  return {
    estas_al_dia: pagables.length === 0,
    mensaje: pagables.length === 0 ? 'Estás al día' : null,
    resumen,
    cuotas: cuotas.map(({ debt, unidad }) => presentarCuota(debt, unidad, payerId)),
  };
}

/** RF-R-05: cuotas de una unidad ordenadas por vencimiento ascendente. */
export async function cuotasDeUnidad(payerId, unitId, estados) {
  const unidad = await unidadDelPagador(pool, payerId, unitId);
  const cuotas = await cuotasVisibles(payerId, [unidad], estados);
  return { unidad: resumenUnidad(unidad), cuotas: cuotas.map(({ debt }) => presentarCuota(debt, unidad, payerId)) };
}

const CTE_HISTORIAL = `
  WITH visibles AS (
    SELECT td.transaction_id, td.debt_id, td.monto_aplicado
      FROM transactions t
      JOIN transaction_debts td ON td.transaction_id = t.id
      JOIN debts d ON d.id = td.debt_id
     WHERE t.tipo_asiento = 'CARGO' AND t.estado IN ('EXITOSO', 'REVERSADO')
       AND (d.billing_unit_id = ANY($1::uuid[]) OR (d.billing_unit_id = ANY($2::uuid[]) AND t.payer_id = $3))
       AND ($4::int IS NULL OR EXTRACT(YEAR FROM t.fecha_pago)::int = $4)
       AND ($5::text IS NULL OR d.periodo = $5)
  )`;

/** RF-R-06: historial paginado, total histórico y extornos vinculados. */
export async function historialPagos(payerId, { unitId, year, periodo, page, pageSize }) {
  const unidades = unitId ? [await unidadDelPagador(pool, payerId, unitId)] : await unidadesDelPagador(pool, payerId);
  const alcance = alcanceHistorial(unidades);
  const params = [alcance.unidadCompleta, alcance.soloPropios, payerId, year ?? null, periodo ?? null];

  const { rows } = await pool.query(
    `${CTE_HISTORIAL}
     SELECT t.id, t.codigo_operacion, t.fecha_pago, t.metodo_pago, t.estado, t.moneda, t.monto_total_cobrado,
            SUM(v.monto_aplicado) AS monto_aplicado,
            json_agg(json_build_object('debt_id', d.id, 'periodo', d.periodo, 'concepto', d.concepto_principal,
                     'codigo_interno', bu.codigo_interno, 'monto_aplicado', v.monto_aplicado::text) ORDER BY d.periodo) AS cuotas,
            count(*) OVER () AS total_registros
       FROM visibles v
       JOIN transactions t ON t.id = v.transaction_id
       JOIN debts d ON d.id = v.debt_id
       JOIN billing_units bu ON bu.id = d.billing_unit_id
      GROUP BY t.id
      ORDER BY t.fecha_pago DESC NULLS LAST, t.created_at DESC
      LIMIT $6 OFFSET $7`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  const { rows: totales } = await pool.query(
    `${CTE_HISTORIAL}
     SELECT t.moneda, SUM(v.monto_aplicado) AS total
       FROM visibles v JOIN transactions t ON t.id = v.transaction_id
      WHERE t.estado = 'EXITOSO'
      GROUP BY t.moneda`,
    params
  );

  const ids = rows.map((r) => r.id);
  const { rows: extornos } = ids.length
    ? await pool.query(
        `SELECT id, transaccion_origen_id, codigo_operacion, created_at AS fecha, monto_total_cobrado, moneda
           FROM transactions WHERE tipo_asiento = 'EXTORNO' AND transaccion_origen_id = ANY($1::uuid[])`,
        [ids]
      )
    : { rows: [] };

  return {
    total_historico_pagado: totales.map((t) => ({ moneda: t.moneda, monto: t.total })),
    page,
    page_size: pageSize,
    total_registros: Number(rows[0]?.total_registros ?? 0),
    pagos: rows.map(({ total_registros, estado, ...r }) => ({
      ...r,
      estado: estado === 'REVERSADO' ? 'EXTORNADO' : 'PAGADO',
      extornos: extornos.filter((e) => e.transaccion_origen_id === r.id).map(({ transaccion_origen_id, ...e }) => e),
    })),
  };
}

export async function datosAvisoCobranza(payerId, debtId) {
  const { rows } = await pool.query('SELECT * FROM debts WHERE id = $1', [debtId]);
  const debt = rows[0];
  if (!debt) throw notFound('Cuota no encontrada', 'DEBT_NOT_FOUND');
  const [unidad] = await unidadesDelPagador(pool, payerId, { unitIds: [debt.billing_unit_id] });
  if (!unidad || !puedeVerCuota(unidad.permisos, debt, payerId)) throw notFound('Cuota no encontrada', 'DEBT_NOT_FOUND');
  return { cuota: presentarCuota(debt, unidad, payerId), unidad: presentarUnidadCompleta(unidad) };
}

export async function datosComprobante(payerId, transactionId) {
  const { rows } = await pool.query(
    `SELECT t.*, p.nombres, p.apellidos, p.tipo_doc, p.num_doc, ou.nombre AS edificio, ou.direccion,
            COALESCE(tn.nombre_comercial, tn.razon_social) AS administradora, tn.ruc
       FROM transactions t
       JOIN payers p ON p.id = t.payer_id
       JOIN organization_units ou ON ou.id = t.organization_unit_id
       JOIN tenants tn ON tn.id = t.tenant_id
      WHERE t.id = $1 AND t.estado = 'EXITOSO' AND t.tipo_asiento = 'CARGO'`,
    [transactionId]
  );
  const tx = rows[0];
  if (!tx) throw notFound('Comprobante no encontrado', 'RECEIPT_NOT_FOUND');

  const { rows: cuotas } = await pool.query(
    `SELECT d.id, d.billing_unit_id, d.periodo, d.concepto_principal, td.monto_aplicado, bu.codigo_interno
       FROM transaction_debts td JOIN debts d ON d.id = td.debt_id JOIN billing_units bu ON bu.id = d.billing_unit_id
      WHERE td.transaction_id = $1 ORDER BY d.periodo`,
    [transactionId]
  );

  if (tx.payer_id !== payerId) {
    const unidades = await unidadesDelPagador(pool, payerId, { unitIds: [...new Set(cuotas.map((c) => c.billing_unit_id))] });
    if (!unidades.some((u) => u.permisos.historial === 'UNIDAD')) throw notFound('Comprobante no encontrado', 'RECEIPT_NOT_FOUND');
  }
  return { tx, cuotas };
}

/** RF-R-04 criterio 3: el residente reporta un dato incorrecto sin editarlo. */
export async function reportarDatoIncorrecto(payerId, unitId, descripcion, req) {
  const unidad = await unidadDelPagador(pool, payerId, unitId);
  const { rows } = await pool.query(
    `INSERT INTO data_issues (tenant_id, billing_unit_id, payer_id, descripcion) VALUES ($1, $2, $3, $4) RETURNING id, estado, created_at`,
    [unidad.tenant_id, unidad.id, payerId, descripcion]
  );
  await encolarParaAdministradores(pool, {
    tenantId: unidad.tenant_id,
    plantilla: PLANTILLA.DATO_INCORRECTO,
    payload: { data_issue_id: rows[0].id, codigo_interno: unidad.codigo_interno, edificio: unidad.edificio_nombre, descripcion },
  });
  await audit(pool, { req, tenantId: unidad.tenant_id, accion: 'DATO_INCORRECTO_REPORTADO', entidad: 'billing_units', entidadId: unidad.id });
  return rows[0];
}
