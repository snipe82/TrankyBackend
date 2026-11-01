import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { randomToken, sha256 } from '../../shared/security.js';
import { signPayLinkToken } from '../../middleware/auth.js';
import { puedePagarCuota } from '../../config/organizationUnitConfig.js';
import { unidadesDelPagador } from '../payer/access.service.js';
import { presentarCuota } from '../payer/presenters.js';

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** RF-R-14: link opaco de un solo uso; en BD solo se guarda el hash del token. */
export async function crearPayLink(db, { tenantId, debtId, payerId }) {
  const token = randomToken(32);
  const { rows } = await db.query(
    `INSERT INTO pay_links (token_hash, tenant_id, debt_id, payer_id, expira_en)
     VALUES ($1, $2, $3, $4, NOW() + make_interval(hours => $5))
     RETURNING id, expira_en`,
    [sha256(token), tenantId, debtId, payerId, env.payLinks.ttlHoras]
  );
  return { id: rows[0].id, url: `${env.payLinks.baseUrl}${token}`, expira_en: rows[0].expira_en };
}

const linkNoDisponible = () =>
  new AppError(410, 'PAY_LINK_EXPIRED', 'El link expiró o ya fue usado. Inicia sesión o solicita un nuevo link.');

export async function resolverPayLink(token) {
  if (!TOKEN_FORMAT.test(token)) throw linkNoDisponible();

  const { rows } = await pool.query(
    `SELECT pl.id, pl.payer_id, pl.debt_id, pl.expira_en, pl.usado_en, p.nombres,
            d.id AS d_id, d.billing_unit_id
       FROM pay_links pl
       JOIN payers p ON p.id = pl.payer_id
       JOIN debts d ON d.id = pl.debt_id AND d.tenant_id = pl.tenant_id
      WHERE pl.token_hash = $1`,
    [sha256(token)]
  );
  const link = rows[0];
  if (!link || link.usado_en || new Date(link.expira_en) <= new Date()) throw linkNoDisponible();

  const [unidad] = await unidadesDelPagador(pool, link.payer_id, { unitIds: [link.billing_unit_id] });
  if (!unidad) throw linkNoDisponible();

  const { rows: debts } = await pool.query('SELECT * FROM debts WHERE id = $1', [link.debt_id]);
  const debt = debts[0];
  if (debt.estado === 'PAGADO') throw new AppError(409, 'DEBT_ALREADY_PAID', 'Esta cuota ya fue pagada');
  if (debt.estado === 'ANULADO' || !puedePagarCuota(unidad.permisos, debt, link.payer_id)) throw linkNoDisponible();

  return {
    checkout_token: signPayLinkToken({ payLinkId: link.id, payerId: link.payer_id, debtId: link.debt_id }),
    checkout_token_expira_en_minutos: env.payLinks.checkoutTtlMinutos,
    pagador: { nombres: link.nombres },
    cuota: presentarCuota(debt, unidad, link.payer_id),
    metodos_pago: ['YAPE', 'CARD', 'CIP'],
  };
}
