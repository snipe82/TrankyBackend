import { pool } from '../db/pool.js';

/**
 * RNF-05: registro de auditoría. `db` puede ser el pool o el cliente de una transacción
 * para que el registro quede en la misma unidad de trabajo.
 */
export async function audit(db, { req, actorTipo, actorId, tenantId, accion, entidad, entidadId, detalle }) {
  await (db ?? pool).query(
    `INSERT INTO audit_logs (actor_tipo, actor_id, tenant_id, accion, entidad, entidad_id, detalle_json, ip, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      actorTipo ?? req?.auth?.typ ?? 'SISTEMA',
      actorId ?? req?.auth?.sub ?? null,
      tenantId ?? req?.auth?.tenantId ?? null,
      accion,
      entidad ?? null,
      entidadId ?? null,
      detalle ?? {},
      req?.ip ?? null,
      req?.correlationId ?? null,
    ]
  );
}
