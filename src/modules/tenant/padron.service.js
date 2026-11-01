import { z } from 'zod';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError, notFound } from '../../shared/errors.js';
import { audit } from '../../shared/audit.js';
import { documento, email, uuid } from '../../shared/validation.js';
import { configSchema } from '../../config/organizationUnitConfig.js';
import { presentarUnidad, validarMetadata } from '../../config/rubros.js';

// Regla crítica 6: toda consulta del portal B2B filtra por el tenant del token.

export const edificioSchema = z.object({
  nombre: z.string().trim().min(2).max(255),
  direccion: z.string().trim().max(500).optional(),
  moneda_base: z.enum(['PEN', 'USD']).default('PEN'),
  config_json: configSchema.default({}),
});

export const unidadSchema = z.object({
  organization_unit_id: uuid,
  tipo_unidad: z.string().trim().toUpperCase(),
  codigo_interno: z.string().trim().min(1).max(50),
  alias: z.string().trim().max(255).optional(),
  metadata_json: z.record(z.string(), z.unknown()).default({}),
});

export const pagadorSchema = documento.and(
  z.object({
    nombres: z.string().trim().min(1).max(255),
    apellidos: z.string().trim().min(1).max(255),
    email: email.optional(),
    telefono_whatsapp: z
      .string()
      .trim()
      .regex(/^(51)?9\d{8}$/, 'Teléfono peruano inválido')
      .transform((t) => (t.length === 9 ? `51${t}` : t))
      .optional(),
  })
);

export const relacionSchema = z
  .object({
    billing_unit_id: uuid,
    rol: z.enum(['PROPIETARIO', 'INQUILINO']),
    payer_id: uuid.optional(),
    pagador: pagadorSchema.optional(),
  })
  .refine((v) => Boolean(v.payer_id) !== Boolean(v.pagador), 'Envía payer_id o los datos del pagador');

export async function rubroDelTenant(db, tenantId) {
  const { rows } = await db.query('SELECT rubro FROM tenants WHERE id = $1', [tenantId]);
  return rows[0].rubro;
}

export async function edificioDelTenant(db, tenantId, id) {
  const { rows } = await db.query('SELECT * FROM organization_units WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (!rows[0]) throw notFound('Edificio no encontrado', 'ORGANIZATION_UNIT_NOT_FOUND');
  return rows[0];
}

export async function listarEdificios(tenantId) {
  const { rows } = await pool.query(
    `SELECT ou.*, (SELECT count(*)::int FROM billing_units bu WHERE bu.organization_unit_id = ou.id AND bu.activo) AS total_unidades
       FROM organization_units ou WHERE ou.tenant_id = $1 ORDER BY ou.nombre`,
    [tenantId]
  );
  return rows;
}

export async function crearEdificio(tenantId, input, req) {
  const { rows } = await pool.query(
    `INSERT INTO organization_units (tenant_id, nombre, direccion, moneda_base, config_json)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, input.nombre, input.direccion ?? null, input.moneda_base, input.config_json]
  );
  await audit(pool, { req, accion: 'EDIFICIO_CREADO', entidad: 'organization_units', entidadId: rows[0].id });
  return rows[0];
}

export async function actualizarEdificio(tenantId, id, input, req) {
  await edificioDelTenant(pool, tenantId, id);
  const { rows } = await pool.query(
    `UPDATE organization_units
        SET nombre = COALESCE($3, nombre), direccion = COALESCE($4, direccion),
            config_json = CASE WHEN $5::jsonb IS NULL THEN config_json ELSE config_json || $5::jsonb END
      WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenantId, input.nombre ?? null, input.direccion ?? null, input.config_json ?? null]
  );
  await audit(pool, { req, accion: 'EDIFICIO_ACTUALIZADO', entidad: 'organization_units', entidadId: id, detalle: input });
  return rows[0];
}

export async function listarUnidades(tenantId, { organizationUnitId, tipoUnidad }) {
  const rubro = await rubroDelTenant(pool, tenantId);
  const { rows } = await pool.query(
    `SELECT bu.*, ou.nombre AS edificio,
            COALESCE(json_agg(json_build_object('relacion_id', r.id, 'payer_id', p.id, 'rol', r.rol, 'tipo_doc', p.tipo_doc,
                     'num_doc', p.num_doc, 'nombres', p.nombres, 'apellidos', p.apellidos))
                     FILTER (WHERE r.id IS NOT NULL), '[]') AS residentes
       FROM billing_units bu
       JOIN organization_units ou ON ou.id = bu.organization_unit_id
       LEFT JOIN unit_payer_relations r ON r.billing_unit_id = bu.id AND r.activo
       LEFT JOIN payers p ON p.id = r.payer_id
      WHERE bu.tenant_id = $1
        AND ($2::uuid IS NULL OR bu.organization_unit_id = $2)
        AND ($3::text IS NULL OR bu.tipo_unidad = $3)
      GROUP BY bu.id, ou.nombre
      ORDER BY ou.nombre, bu.tipo_unidad, bu.codigo_interno`,
    [tenantId, organizationUnitId ?? null, tipoUnidad ?? null]
  );
  return rows.map((u) => {
    const { etiqueta, descripcion } = presentarUnidad(rubro, u.tipo_unidad, u.metadata_json);
    return { ...u, tipo_etiqueta: etiqueta, descripcion };
  });
}

export async function crearUnidad(tenantId, input, req) {
  return withTransaction(async (client) => {
    await edificioDelTenant(client, tenantId, input.organization_unit_id);
    const metadata = validarMetadata(await rubroDelTenant(client, tenantId), input.tipo_unidad, input.metadata_json);
    const { rows } = await client.query(
      `INSERT INTO billing_units (tenant_id, organization_unit_id, tipo_unidad, codigo_interno, alias, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, input.organization_unit_id, input.tipo_unidad, input.codigo_interno, input.alias ?? null, metadata]
    );
    await audit(client, { req, accion: 'UNIDAD_CREADA', entidad: 'billing_units', entidadId: rows[0].id });
    return rows[0];
  });
}

export async function actualizarUnidad(tenantId, id, input, req) {
  return withTransaction(async (client) => {
    const { rows: actuales } = await client.query('SELECT * FROM billing_units WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [id, tenantId]);
    const actual = actuales[0];
    if (!actual) throw notFound('Unidad no encontrada', 'UNIT_NOT_FOUND');
    const tipo = input.tipo_unidad ?? actual.tipo_unidad;
    const metadata = validarMetadata(await rubroDelTenant(client, tenantId), tipo, { ...actual.metadata_json, ...(input.metadata_json ?? {}) });
    const { rows } = await client.query(
      `UPDATE billing_units
          SET tipo_unidad = $3, alias = COALESCE($4, alias), metadata_json = $5, activo = COALESCE($6, activo)
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenantId, tipo, input.alias ?? null, metadata, input.activo ?? null]
    );
    await audit(client, { req, accion: 'UNIDAD_ACTUALIZADA', entidad: 'billing_units', entidadId: id, detalle: input });
    return rows[0];
  });
}

/** Pagadores globales: se reutiliza la persona si el documento ya existe. */
export async function buscarOCrearPagador(db, input) {
  const { rows } = await db.query(
    `INSERT INTO payers (tipo_doc, num_doc, nombres, apellidos, email, telefono_whatsapp)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tipo_doc, num_doc) DO UPDATE
       SET email = COALESCE(payers.email, EXCLUDED.email),
           telefono_whatsapp = COALESCE(payers.telefono_whatsapp, EXCLUDED.telefono_whatsapp)
     RETURNING id, tipo_doc, num_doc, nombres, apellidos, (xmax = 0) AS creado`,
    [input.tipo_doc, input.num_doc, input.nombres, input.apellidos, input.email ?? null, input.telefono_whatsapp ?? null]
  );
  return rows[0];
}

export async function listarPagadores(tenantId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.tipo_doc, p.num_doc, p.nombres, p.apellidos, p.email, p.telefono_whatsapp,
            json_agg(json_build_object('relacion_id', r.id, 'billing_unit_id', bu.id, 'codigo_interno', bu.codigo_interno, 'rol', r.rol, 'activo', r.activo)
                     ORDER BY bu.codigo_interno) AS unidades
       FROM unit_payer_relations r
       JOIN payers p ON p.id = r.payer_id
       JOIN billing_units bu ON bu.id = r.billing_unit_id
      WHERE r.tenant_id = $1
      GROUP BY p.id
      ORDER BY p.apellidos, p.nombres`,
    [tenantId]
  );
  return rows;
}

export async function crearRelacion(tenantId, input, req) {
  return withTransaction(async (client) => {
    const { rows: unidades } = await client.query('SELECT id FROM billing_units WHERE id = $1 AND tenant_id = $2', [input.billing_unit_id, tenantId]);
    if (!unidades[0]) throw notFound('Unidad no encontrada', 'UNIT_NOT_FOUND');

    let payerId = input.payer_id;
    if (input.pagador) {
      payerId = (await buscarOCrearPagador(client, input.pagador)).id;
    } else {
      const { rows } = await client.query('SELECT id FROM payers WHERE id = $1', [payerId]);
      if (!rows[0]) throw notFound('Pagador no encontrado', 'PAYER_NOT_FOUND');
    }

    const { rows } = await client.query(
      `INSERT INTO unit_payer_relations (tenant_id, billing_unit_id, payer_id, rol)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (billing_unit_id, payer_id, rol) WHERE activo DO NOTHING
       RETURNING *`,
      [tenantId, input.billing_unit_id, payerId, input.rol]
    );
    if (!rows[0]) throw new AppError(409, 'RELATION_EXISTS', 'El pagador ya tiene ese rol activo en la unidad');
    await audit(client, { req, accion: 'RELACION_CREADA', entidad: 'unit_payer_relations', entidadId: rows[0].id, detalle: { rol: input.rol } });
    return rows[0];
  });
}

/** Fin de arrendamiento u otra baja: se desactiva, nunca se borra (FSD-002 §4.1). */
export async function desactivarRelacion(tenantId, id, req) {
  const { rows } = await pool.query(
    `UPDATE unit_payer_relations SET activo = FALSE, fecha_fin = CURRENT_DATE
      WHERE id = $1 AND tenant_id = $2 AND activo RETURNING *`,
    [id, tenantId]
  );
  if (!rows[0]) throw notFound('Relación activa no encontrada', 'RELATION_NOT_FOUND');
  await audit(pool, { req, accion: 'RELACION_DESACTIVADA', entidad: 'unit_payer_relations', entidadId: id });
  return rows[0];
}
