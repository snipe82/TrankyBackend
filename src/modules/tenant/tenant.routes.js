import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate, TOKEN } from '../../middleware/auth.js';
import { AppError } from '../../shared/errors.js';
import { paginacion, periodo, uuid } from '../../shared/validation.js';
import { configSchema } from '../../config/organizationUnitConfig.js';
import {
  actualizarEdificio,
  actualizarUnidad,
  crearEdificio,
  crearRelacion,
  crearUnidad,
  desactivarRelacion,
  edificioSchema,
  listarEdificios,
  listarPagadores,
  listarUnidades,
  relacionSchema,
  unidadSchema,
} from './padron.service.js';
import { importarPadron, importQuerySchema, plantillaPadron } from './import.service.js';
import { emisionSchema, emitirCuotas } from './emision.service.js';
import { kpis, listarCuotas, listarLiquidaciones, listarReportes, listarTransacciones } from './monitor.service.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

router.use(authenticate(TOKEN.TENANT_ADMIN));

const tenantId = (req) => req.auth.tenantId;
const filtroEdificio = z.object({ organization_unit_id: uuid.optional() });

router.get('/organization-units', async (req, res) => {
  res.json(await listarEdificios(tenantId(req)));
});

router.post('/organization-units', async (req, res) => {
  res.status(201).json(await crearEdificio(tenantId(req), edificioSchema.parse(req.body), req));
});

router.patch('/organization-units/:id', async (req, res) => {
  const input = z
    .object({ nombre: z.string().trim().min(2).max(255).optional(), direccion: z.string().trim().max(500).optional(), config_json: configSchema.optional() })
    .parse(req.body);
  res.json(await actualizarEdificio(tenantId(req), uuid.parse(req.params.id), input, req));
});

router.get('/units', async (req, res) => {
  const q = filtroEdificio.extend({ tipo_unidad: z.string().toUpperCase().optional() }).parse(req.query);
  res.json(await listarUnidades(tenantId(req), { organizationUnitId: q.organization_unit_id, tipoUnidad: q.tipo_unidad }));
});

router.post('/units', async (req, res) => {
  res.status(201).json(await crearUnidad(tenantId(req), unidadSchema.parse(req.body), req));
});

router.patch('/units/:id', async (req, res) => {
  const input = z
    .object({
      tipo_unidad: z.string().trim().toUpperCase().optional(),
      alias: z.string().trim().max(255).optional(),
      metadata_json: z.record(z.string(), z.unknown()).optional(),
      activo: z.boolean().optional(),
    })
    .parse(req.body);
  res.json(await actualizarUnidad(tenantId(req), uuid.parse(req.params.id), input, req));
});

router.get('/units/bulk-import/template', async (_req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-padron-tranky.xlsx"');
  res.send(Buffer.from(await plantillaPadron()));
});

// RF-S-02: ?modo=validar (por defecto) devuelve errores por fila; ?modo=confirmar aplica si no hay errores.
router.post('/units/bulk-import', upload.single('archivo'), async (req, res) => {
  const q = importQuerySchema.parse({ ...req.query, ...(req.body?.organization_unit_id ? { organization_unit_id: req.body.organization_unit_id } : {}) });
  if (!req.file) throw new AppError(400, 'FILE_REQUIRED', 'Adjunta el archivo .xlsx en el campo "archivo"');
  const resultado = await importarPadron(tenantId(req), q.organization_unit_id, req.file.buffer, { confirmar: q.modo === 'confirmar' }, req);
  res.status(resultado.valido ? 200 : 422).json(resultado);
});

router.get('/payers', async (req, res) => {
  res.json(await listarPagadores(tenantId(req)));
});

router.post('/unit-relations', async (req, res) => {
  res.status(201).json(await crearRelacion(tenantId(req), relacionSchema.parse(req.body), req));
});

router.post('/unit-relations/:id/deactivate', async (req, res) => {
  res.json(await desactivarRelacion(tenantId(req), uuid.parse(req.params.id), req));
});

router.post('/debts/generate', async (req, res) => {
  res.status(201).json(await emitirCuotas(tenantId(req), emisionSchema.parse(req.body), req));
});

router.get('/debts', async (req, res) => {
  const q = paginacion
    .merge(filtroEdificio)
    .extend({ periodo: periodo.optional(), estado: z.enum(['PENDIENTE', 'VENCIDO', 'EN_PROCESO', 'PAGADO', 'ANULADO']).optional() })
    .parse(req.query);
  res.json(await listarCuotas(tenantId(req), { organizationUnitId: q.organization_unit_id, periodo: q.periodo, estado: q.estado, page: q.page, pageSize: q.page_size }));
});

router.get('/transactions', async (req, res) => {
  const q = paginacion
    .merge(filtroEdificio)
    .extend({ estado: z.enum(['INICIADO', 'EXITOSO', 'FALLIDO', 'REVERSADO']).optional() })
    .parse(req.query);
  res.json(await listarTransacciones(tenantId(req), { organizationUnitId: q.organization_unit_id, estado: q.estado, page: q.page, pageSize: q.page_size }));
});

router.get('/dashboard/kpis', async (req, res) => {
  const q = filtroEdificio.extend({ periodo: periodo.optional() }).parse(req.query);
  res.json(await kpis(tenantId(req), { organizationUnitId: q.organization_unit_id, periodo: q.periodo }));
});

router.get('/data-issues', async (req, res) => {
  const { estado } = z.object({ estado: z.enum(['ABIERTO', 'RESUELTO']).optional() }).parse(req.query);
  res.json(await listarReportes(tenantId(req), { estado }));
});

router.get('/settlements', async (req, res) => {
  const q = filtroEdificio.parse(req.query);
  res.json(await listarLiquidaciones(tenantId(req), { organizationUnitId: q.organization_unit_id }));
});

export default router;
