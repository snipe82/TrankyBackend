import ExcelJS from 'exceljs';
import { z } from 'zod';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { audit } from '../../shared/audit.js';
import { catalogo, validarMetadata } from '../../config/rubros.js';
import { buscarOCrearPagador, edificioDelTenant, pagadorSchema, rubroDelTenant } from './padron.service.js';

export const COLUMNAS = [
  'codigo_interno', 'tipo_unidad', 'alias', 'piso', 'numero', 'nivel', 'area_m2', 'alicuota', 'techada', 'dormitorios',
  'rol', 'tipo_doc', 'num_doc', 'nombres', 'apellidos', 'email', 'telefono_whatsapp',
];
const CAMPOS_METADATA = { piso: 'int', numero: 'text', nivel: 'text', area_m2: 'number', alicuota: 'number', techada: 'bool', dormitorios: 'int' };
const MAX_FILAS = 5000;
const ROLES = ['PROPIETARIO', 'INQUILINO'];

function textoCelda(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.text !== undefined) return String(value.text).trim();
    if (value.richText) return value.richText.map((r) => r.text).join('').trim();
    if (value.result !== undefined) return String(value.result).trim();
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function convertir(tipo, texto) {
  if (texto === '') return undefined;
  if (tipo === 'text') return texto;
  if (tipo === 'bool') {
    const v = texto.toUpperCase();
    if (['SI', 'SÍ', 'TRUE', '1', 'X'].includes(v)) return true;
    if (['NO', 'FALSE', '0'].includes(v)) return false;
    throw new Error('debe ser SI o NO');
  }
  const n = Number(texto.replace(',', '.'));
  if (Number.isNaN(n) || (tipo === 'int' && !Number.isInteger(n))) throw new Error(tipo === 'int' ? 'debe ser un entero' : 'debe ser numérico');
  return n;
}

async function leerFilas(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new AppError(400, 'INVALID_FILE', 'El archivo no es un .xlsx válido');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new AppError(400, 'INVALID_FILE', 'El archivo no tiene hojas');

  const encabezados = {};
  sheet.getRow(1).eachCell((cell, col) => {
    encabezados[col] = textoCelda(cell.value).toLowerCase();
  });
  const faltantes = ['codigo_interno', 'tipo_unidad'].filter((c) => !Object.values(encabezados).includes(c));
  if (faltantes.length) throw new AppError(400, 'INVALID_TEMPLATE', `Faltan columnas obligatorias: ${faltantes.join(', ')}`);

  const filas = [];
  sheet.eachRow((row, numero) => {
    if (numero === 1) return;
    const datos = {};
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (encabezados[col]) datos[encabezados[col]] = textoCelda(cell.value);
    });
    if (Object.values(datos).some((v) => v !== '')) filas.push({ numero, datos });
  });
  if (filas.length > MAX_FILAS) throw new AppError(400, 'TOO_MANY_ROWS', `Máximo ${MAX_FILAS} filas por archivo`);
  return filas;
}

/**
 * RF-S-02: valida el padrón completo antes de aplicar nada (todo o nada).
 * Una fila = una unidad y, opcionalmente, un residente con su rol en esa unidad.
 */
export async function importarPadron(tenantId, organizationUnitId, buffer, { confirmar }, req) {
  await edificioDelTenant(pool, tenantId, organizationUnitId);
  const rubro = await rubroDelTenant(pool, tenantId);
  const tiposValidos = Object.keys(catalogo(rubro).tiposUnidad);
  const filas = await leerFilas(buffer);

  const errores = [];
  const advertencias = [];
  const error = (fila, campo, mensaje) => errores.push({ fila, campo, mensaje });

  const { rows: existentes } = await pool.query(
    'SELECT id, codigo_interno, tipo_unidad FROM billing_units WHERE organization_unit_id = $1',
    [organizationUnitId]
  );
  const existentesPorCodigo = new Map(existentes.map((u) => [u.codigo_interno.toUpperCase(), u]));

  const unidades = new Map();
  const personas = new Map();
  const relaciones = new Set();
  const plan = [];

  for (const { numero, datos } of filas) {
    const codigo = (datos.codigo_interno ?? '').toUpperCase();
    const tipo = (datos.tipo_unidad ?? '').toUpperCase();
    if (!codigo) error(numero, 'codigo_interno', 'Obligatorio');
    if (!tiposValidos.includes(tipo)) error(numero, 'tipo_unidad', `Tipo no reconocido. Válidos: ${tiposValidos.join(', ')}`);

    let metadata = {};
    for (const [campo, tipoCampo] of Object.entries(CAMPOS_METADATA)) {
      try {
        const valor = convertir(tipoCampo, datos[campo] ?? '');
        if (valor !== undefined) metadata[campo] = valor;
      } catch (e) {
        error(numero, campo, e.message);
      }
    }
    if (tiposValidos.includes(tipo)) {
      try {
        metadata = validarMetadata(rubro, tipo, metadata);
      } catch (e) {
        (e.details ?? [{ path: 'metadata', message: e.message }]).forEach((d) => error(numero, d.path, d.message));
      }
    }

    if (codigo) {
      const previa = unidades.get(codigo);
      if (previa && previa.tipo !== tipo) error(numero, 'codigo_interno', `Código repetido en la fila ${previa.fila} con otro tipo de unidad`);
      const enBd = existentesPorCodigo.get(codigo);
      if (enBd && enBd.tipo_unidad !== tipo) error(numero, 'codigo_interno', `Ya existe en el edificio como ${enBd.tipo_unidad}`);
      if (!previa) unidades.set(codigo, { fila: numero, tipo, alias: datos.alias || null, metadata, existente: enBd ?? null });
    }

    let persona = null;
    const rol = (datos.rol ?? '').toUpperCase();
    const tieneResidente = rol || datos.num_doc;
    if (tieneResidente) {
      if (!ROLES.includes(rol)) error(numero, 'rol', `Rol inválido. Válidos: ${ROLES.join(', ')}`);
      const parsed = pagadorSchema.safeParse({
        tipo_doc: (datos.tipo_doc || 'DNI').toUpperCase(),
        num_doc: datos.num_doc ?? '',
        nombres: datos.nombres ?? '',
        apellidos: datos.apellidos ?? '',
        email: datos.email || undefined,
        telefono_whatsapp: datos.telefono_whatsapp || undefined,
      });
      if (!parsed.success) {
        parsed.error.issues.forEach((i) => error(numero, i.path.join('.') || 'residente', i.message));
      } else {
        persona = parsed.data;
        const clave = `${persona.tipo_doc}:${persona.num_doc}`;
        const previa = personas.get(clave);
        if (previa && (previa.nombres !== persona.nombres || previa.apellidos !== persona.apellidos)) {
          error(numero, 'num_doc', `Documento duplicado con nombres distintos (fila ${previa.fila})`);
        }
        if (!previa) personas.set(clave, { ...persona, fila: numero });
        const claveRelacion = `${codigo}|${clave}|${rol}`;
        if (relaciones.has(claveRelacion)) error(numero, 'num_doc', 'Fila duplicada: mismo residente y rol en la unidad');
        relaciones.add(claveRelacion);
      }
    }
    plan.push({ codigo, rol, persona });
  }

  if (personas.size) {
    const docs = [...personas.values()];
    const { rows } = await pool.query(
      `SELECT tipo_doc, num_doc, nombres, apellidos FROM payers
        WHERE (tipo_doc, num_doc) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
      [docs.map((p) => p.tipo_doc), docs.map((p) => p.num_doc)]
    );
    for (const r of rows) {
      const p = personas.get(`${r.tipo_doc}:${r.num_doc}`);
      p.existente = true;
      if (p.nombres !== r.nombres || p.apellidos !== r.apellidos) {
        advertencias.push({ fila: p.fila, campo: 'num_doc', mensaje: `El documento ya está registrado como ${r.nombres} ${r.apellidos}; se conservarán esos nombres` });
      }
    }
  }

  const resumen = {
    filas_leidas: filas.length,
    unidades_nuevas: [...unidades.values()].filter((u) => !u.existente).length,
    unidades_existentes: [...unidades.values()].filter((u) => u.existente).length,
    pagadores_nuevos: [...personas.values()].filter((p) => !p.existente).length,
    relaciones: relaciones.size,
  };
  const resultado = { modo: confirmar ? 'CONFIRMAR' : 'VALIDAR', valido: errores.length === 0, resumen, errores, advertencias };
  if (!confirmar || errores.length) return { ...resultado, aplicado: false };

  await withTransaction(async (client) => {
    const ids = new Map();
    for (const [codigo, u] of unidades) {
      const { rows } = await client.query(
        `INSERT INTO billing_units (tenant_id, organization_unit_id, tipo_unidad, codigo_interno, alias, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (organization_unit_id, codigo_interno) DO UPDATE
           SET alias = COALESCE(EXCLUDED.alias, billing_units.alias),
               metadata_json = billing_units.metadata_json || EXCLUDED.metadata_json
         RETURNING id`,
        [tenantId, organizationUnitId, u.tipo, u.existente?.codigo_interno ?? codigo, u.alias, u.metadata]
      );
      ids.set(codigo, rows[0].id);
    }
    for (const { codigo, rol, persona } of plan) {
      if (!persona) continue;
      const payer = await buscarOCrearPagador(client, persona);
      await client.query(
        `INSERT INTO unit_payer_relations (tenant_id, billing_unit_id, payer_id, rol)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (billing_unit_id, payer_id, rol) WHERE activo DO NOTHING`,
        [tenantId, ids.get(codigo), payer.id, rol]
      );
    }
    await audit(client, { req, accion: 'PADRON_IMPORTADO', entidad: 'organization_units', entidadId: organizationUnitId, detalle: resumen });
  });
  return { ...resultado, aplicado: true };
}

export async function plantillaPadron() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('padron');
  sheet.addRow(COLUMNAS);
  sheet.addRow(['DPTO-402', 'DEPARTAMENTO', 'Dpto 402', 4, '402', '', 85.5, 1.25, '', 3, 'PROPIETARIO', 'DNI', '45678901', 'Juan', 'Pérez', 'juan@example.com', '987654321']);
  sheet.addRow(['DEP-S1-12', 'DEPOSITO', '', '', '12', 'S1', 4, 0.1, '', '', 'PROPIETARIO', 'DNI', '45678901', 'Juan', 'Pérez', '', '']);
  sheet.addRow(['COCH-S2-07', 'COCHERA', '', '', '07', 'S2', 12.5, 0.3, 'SI', '', 'INQUILINO', 'DNI', '41234567', 'María', 'Torres', '', '912345678']);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((c) => (c.width = 16));
  return workbook.xlsx.writeBuffer();
}

export const importQuerySchema = z.object({
  organization_unit_id: z.uuid({ message: 'organization_unit_id inválido' }),
  modo: z.enum(['validar', 'confirmar']).default('validar'),
});
