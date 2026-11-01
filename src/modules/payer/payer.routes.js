import { Router } from 'express';
import { z } from 'zod';
import { authenticate, TOKEN } from '../../middleware/auth.js';
import { payLinkLimiter } from '../../middleware/rateLimits.js';
import { paginacion, periodo, uuid } from '../../shared/validation.js';
import { cambiarPassword } from '../auth/auth.service.js';
import { renderAvisoCobranza, renderComprobante } from '../documents/pdf.service.js';
import { resolverPayLink } from '../payLinks/payLinks.service.js';
import {
  cuotasDeUnidad,
  dashboardDeuda,
  datosAvisoCobranza,
  datosComprobante,
  historialPagos,
  listarUnidades,
  misPropiedades,
  reportarDatoIncorrecto,
} from './payer.service.js';
import {
  actualizarMedio,
  actualizarMedioSchema,
  agregarMedio,
  eliminarMedio,
  listarMedios,
  nuevoMedioSchema,
} from './paymentMethods.service.js';

const router = Router();

// RF-R-14: público, protegido por el token opaco del link.
router.get('/pay-links/:token', payLinkLimiter, async (req, res) => {
  res.json(await resolverPayLink(req.params.token));
});

router.use(authenticate(TOKEN.PAYER));

const ESTADOS_CUOTA = ['PENDIENTE', 'VENCIDO', 'EN_PROCESO', 'PAGADO', 'ANULADO'];
const estadosQuery = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim().toUpperCase()) : ['PENDIENTE', 'VENCIDO', 'EN_PROCESO']))
  .pipe(z.array(z.enum(ESTADOS_CUOTA)).min(1));

const historialQuery = paginacion.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  periodo: periodo.optional(),
  unit_id: uuid.optional(),
});

router.get('/units', async (req, res) => {
  res.json(await listarUnidades(req.auth.sub));
});

router.get('/properties', async (req, res) => {
  res.json(await misPropiedades(req.auth.sub));
});

router.get('/debts', async (req, res) => {
  const { unit_id } = z.object({ scope: z.enum(['all']).optional(), unit_id: uuid.optional() }).parse(req.query);
  res.json(await dashboardDeuda(req.auth.sub, { unitId: unit_id }));
});

router.get('/units/:id/debts', async (req, res) => {
  const estados = estadosQuery.parse(req.query.status);
  res.json(await cuotasDeUnidad(req.auth.sub, uuid.parse(req.params.id), estados));
});

router.get('/units/:id/transactions', async (req, res) => {
  const q = historialQuery.parse(req.query);
  res.json(
    await historialPagos(req.auth.sub, { unitId: uuid.parse(req.params.id), year: q.year, periodo: q.periodo, page: q.page, pageSize: q.page_size })
  );
});

router.get('/transactions', async (req, res) => {
  const q = historialQuery.parse(req.query);
  res.json(await historialPagos(req.auth.sub, { unitId: q.unit_id, year: q.year, periodo: q.periodo, page: q.page, pageSize: q.page_size }));
});

router.get('/debts/:id/notice.pdf', async (req, res) => {
  renderAvisoCobranza(res, await datosAvisoCobranza(req.auth.sub, uuid.parse(req.params.id)));
});

router.get('/transactions/:id/receipt.pdf', async (req, res) => {
  renderComprobante(res, await datosComprobante(req.auth.sub, uuid.parse(req.params.id)));
});

router.post('/units/:id/data-issues', async (req, res) => {
  const { descripcion } = z.object({ descripcion: z.string().trim().min(5).max(1000) }).parse(req.body);
  res.status(201).json(await reportarDatoIncorrecto(req.auth.sub, uuid.parse(req.params.id), descripcion, req));
});

router.put('/me/password', async (req, res) => {
  const body = z
    .object({
      password_actual: z.string().max(200).optional(),
      password_nueva: z.string().min(8, 'Mínimo 8 caracteres').max(200),
    })
    .parse(req.body);
  await cambiarPassword(req.auth.sub, body, req);
  res.status(204).end();
});

router.get('/payment-methods', async (req, res) => {
  res.json(await listarMedios(req.auth.sub));
});

router.post('/payment-methods', async (req, res) => {
  res.status(201).json(await agregarMedio(req.auth.sub, nuevoMedioSchema.parse(req.body), req));
});

router.patch('/payment-methods/:id', async (req, res) => {
  res.json(await actualizarMedio(req.auth.sub, uuid.parse(req.params.id), actualizarMedioSchema.parse(req.body), req));
});

router.delete('/payment-methods/:id', async (req, res) => {
  const { confirmar } = z.object({ confirmar: z.enum(['true', 'false']).default('false') }).parse(req.query);
  res.json(await eliminarMedio(req.auth.sub, uuid.parse(req.params.id), { confirmar: confirmar === 'true' }, req));
});

export default router;
