import { notFound } from '../../shared/errors.js';
import { permisosEfectivos, resolverConfig } from '../../config/organizationUnitConfig.js';

/**
 * Unidades con relación activa del pagador (RF-R-02) junto con sus permisos efectivos
 * según la configuración del edificio. Es la única puerta de acceso a datos del residente.
 */
export async function unidadesDelPagador(db, payerId, { unitIds = null } = {}) {
  const { rows } = await db.query(
    `SELECT bu.id, bu.tenant_id, bu.organization_unit_id, bu.tipo_unidad, bu.codigo_interno, bu.alias, bu.metadata_json,
            ou.nombre AS edificio_nombre, ou.direccion AS edificio_direccion, ou.moneda_base, ou.config_json,
            t.rubro, COALESCE(t.nombre_comercial, t.razon_social) AS administradora,
            array_agg(DISTINCT r.rol ORDER BY r.rol) AS roles
       FROM unit_payer_relations r
       JOIN billing_units bu ON bu.id = r.billing_unit_id AND bu.tenant_id = r.tenant_id
       JOIN organization_units ou ON ou.id = bu.organization_unit_id AND ou.tenant_id = bu.tenant_id
       JOIN tenants t ON t.id = bu.tenant_id
      WHERE r.payer_id = $1 AND r.activo AND bu.activo AND ou.activo AND t.estado = 'ACTIVO'
        AND ($2::uuid[] IS NULL OR bu.id = ANY($2::uuid[]))
      GROUP BY bu.id, ou.id, t.id
      ORDER BY ou.nombre, bu.tipo_unidad, bu.codigo_interno`,
    [payerId, unitIds]
  );
  return rows.map((row) => {
    const config = resolverConfig(row.config_json);
    return { ...row, config, permisos: permisosEfectivos(config, row.roles) };
  });
}

export async function unidadDelPagador(db, payerId, unitId) {
  const [unidad] = await unidadesDelPagador(db, payerId, { unitIds: [unitId] });
  if (!unidad) throw notFound('Unidad no encontrada', 'UNIT_NOT_FOUND');
  return unidad;
}
