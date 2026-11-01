import { pool } from '../../db/pool.js';
import { fromCents, toCents } from '../../shared/money.js';

/** RF-S-05: KPIs por edificio y periodo, agrupados por moneda. */
export async function kpis(tenantId, { organizationUnitId, periodo }) {
  const params = [tenantId, organizationUnitId ?? null, periodo ?? null];
  const filtro = `d.tenant_id = $1
    AND ($2::uuid IS NULL OR bu.organization_unit_id = $2)
    AND ($3::text IS NULL OR d.periodo = $3)`;

  const { rows: emitido } = await pool.query(
    `SELECT d.moneda,
            count(*) FILTER (WHERE d.estado <> 'ANULADO')::int AS cuotas_emitidas,
            COALESCE(SUM(d.monto_total) FILTER (WHERE d.estado <> 'ANULADO'), 0)::numeric(14,2) AS total_emitido,
            COALESCE(SUM(d.monto_total) FILTER (WHERE d.estado = 'PENDIENTE'), 0)::numeric(14,2) AS total_pendiente,
            COALESCE(SUM(d.monto_total) FILTER (WHERE d.estado = 'VENCIDO'), 0)::numeric(14,2) AS total_en_mora,
            COALESCE(SUM(d.monto_mora) FILTER (WHERE d.estado = 'VENCIDO'), 0)::numeric(14,2) AS recargos_mora,
            COALESCE(SUM(d.monto_total) FILTER (WHERE d.estado = 'EN_PROCESO'), 0)::numeric(14,2) AS pago_en_proceso,
            count(*) FILTER (WHERE d.estado = 'VENCIDO')::int AS cuotas_vencidas
       FROM debts d JOIN billing_units bu ON bu.id = d.billing_unit_id
      WHERE ${filtro}
      GROUP BY d.moneda`,
    params
  );

  const { rows: recaudado } = await pool.query(
    `SELECT d.moneda, COALESCE(SUM(td.monto_aplicado), 0)::numeric(14,2) AS total_recaudado
       FROM transaction_debts td
       JOIN transactions t ON t.id = td.transaction_id AND t.estado = 'EXITOSO' AND t.tipo_asiento = 'CARGO'
       JOIN debts d ON d.id = td.debt_id
       JOIN billing_units bu ON bu.id = d.billing_unit_id
      WHERE ${filtro}
      GROUP BY d.moneda`,
    params
  );

  const { rows: porLiquidar } = await pool.query(
    `SELECT t.moneda, COALESCE(SUM(t.monto_neto_a_liquidar), 0)::numeric(14,2) AS neto_por_liquidar, count(*)::int AS transacciones
       FROM transactions t
      WHERE t.tenant_id = $1 AND ($2::uuid IS NULL OR t.organization_unit_id = $2)
        AND t.estado = 'EXITOSO' AND t.settlement_id IS NULL
      GROUP BY t.moneda`,
    [tenantId, organizationUnitId ?? null]
  );

  const monedas = new Set([...emitido, ...recaudado, ...porLiquidar].map((r) => r.moneda));
  return {
    filtros: { organization_unit_id: organizationUnitId ?? null, periodo: periodo ?? null },
    kpis: [...monedas].map((moneda) => {
      const e = emitido.find((r) => r.moneda === moneda) ?? {};
      const r = recaudado.find((x) => x.moneda === moneda) ?? {};
      const l = porLiquidar.find((x) => x.moneda === moneda) ?? {};
      const totalEmitido = toCents(e.total_emitido ?? 0);
      const totalRecaudado = toCents(r.total_recaudado ?? 0);
      return {
        moneda,
        cuotas_emitidas: e.cuotas_emitidas ?? 0,
        total_emitido: fromCents(totalEmitido),
        total_recaudado: fromCents(totalRecaudado),
        efectividad_cobranza_pct: totalEmitido ? Math.round((totalRecaudado / totalEmitido) * 10000) / 100 : 0,
        total_pendiente: e.total_pendiente ?? '0.00',
        total_en_mora: e.total_en_mora ?? '0.00',
        recargos_mora: e.recargos_mora ?? '0.00',
        cuotas_vencidas: e.cuotas_vencidas ?? 0,
        pago_en_proceso: e.pago_en_proceso ?? '0.00',
        neto_por_liquidar: l.neto_por_liquidar ?? '0.00',
      };
    }),
  };
}

export async function listarCuotas(tenantId, { organizationUnitId, periodo, estado, page, pageSize }) {
  const { rows } = await pool.query(
    `SELECT d.id, d.periodo, d.concepto_principal, d.tipo_cuota, d.moneda, d.fecha_vencimiento, d.monto_base, d.monto_mora,
            d.monto_total, d.estado, bu.id AS billing_unit_id, bu.codigo_interno, bu.tipo_unidad, ou.nombre AS edificio,
            count(*) OVER () AS total_registros
       FROM debts d
       JOIN billing_units bu ON bu.id = d.billing_unit_id
       JOIN organization_units ou ON ou.id = bu.organization_unit_id
      WHERE d.tenant_id = $1
        AND ($2::uuid IS NULL OR bu.organization_unit_id = $2)
        AND ($3::text IS NULL OR d.periodo = $3)
        AND ($4::text IS NULL OR d.estado = $4)
      ORDER BY d.fecha_vencimiento, bu.codigo_interno
      LIMIT $5 OFFSET $6`,
    [tenantId, organizationUnitId ?? null, periodo ?? null, estado ?? null, pageSize, (page - 1) * pageSize]
  );
  return {
    page,
    page_size: pageSize,
    total_registros: Number(rows[0]?.total_registros ?? 0),
    cuotas: rows.map(({ total_registros, ...r }) => r),
  };
}

export async function listarTransacciones(tenantId, { organizationUnitId, estado, page, pageSize }) {
  const { rows } = await pool.query(
    `SELECT t.id, t.codigo_operacion, t.tipo_asiento, t.estado, t.metodo_pago, t.pasarela, t.moneda,
            t.monto_deuda_cubierta, t.comision_pasarela, t.comision_recaudadora, t.igv_comision, t.monto_total_cobrado,
            t.monto_neto_a_liquidar, t.comision_asumida_por, t.fecha_pago, t.settlement_id, t.created_at,
            p.nombres || ' ' || p.apellidos AS pagador, ou.nombre AS edificio,
            count(*) OVER () AS total_registros
       FROM transactions t
       JOIN payers p ON p.id = t.payer_id
       JOIN organization_units ou ON ou.id = t.organization_unit_id
      WHERE t.tenant_id = $1
        AND ($2::uuid IS NULL OR t.organization_unit_id = $2)
        AND ($3::text IS NULL OR t.estado = $3)
      ORDER BY t.created_at DESC
      LIMIT $4 OFFSET $5`,
    [tenantId, organizationUnitId ?? null, estado ?? null, pageSize, (page - 1) * pageSize]
  );
  return {
    page,
    page_size: pageSize,
    total_registros: Number(rows[0]?.total_registros ?? 0),
    transacciones: rows.map(({ total_registros, ...r }) => r),
  };
}

export async function listarReportes(tenantId, { estado }) {
  const { rows } = await pool.query(
    `SELECT di.id, di.descripcion, di.estado, di.created_at, bu.codigo_interno, ou.nombre AS edificio,
            p.nombres || ' ' || p.apellidos AS reportado_por
       FROM data_issues di
       JOIN billing_units bu ON bu.id = di.billing_unit_id
       JOIN organization_units ou ON ou.id = bu.organization_unit_id
       JOIN payers p ON p.id = di.payer_id
      WHERE di.tenant_id = $1 AND ($2::text IS NULL OR di.estado = $2)
      ORDER BY di.created_at DESC`,
    [tenantId, estado ?? null]
  );
  return rows;
}

export async function listarLiquidaciones(tenantId, { organizationUnitId }) {
  const { rows } = await pool.query(
    `SELECT s.*, ou.nombre AS edificio
       FROM settlements s JOIN organization_units ou ON ou.id = s.organization_unit_id
      WHERE s.tenant_id = $1 AND ($2::uuid IS NULL OR s.organization_unit_id = $2)
      ORDER BY s.fecha_corte DESC`,
    [tenantId, organizationUnitId ?? null]
  );
  return rows;
}
