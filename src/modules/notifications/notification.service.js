import { env } from '../../config/env.js';

export const PLANTILLA = Object.freeze({
  AVISO_COBRANZA: 'AVISO_COBRANZA',
  RECIBO_PAGO: 'RECIBO_PAGO',
  PAGO_RECHAZADO: 'PAGO_RECHAZADO',
  DATO_INCORRECTO: 'DATO_INCORRECTO',
});

function destinatarioPorCanal(payer, canal) {
  if (canal === 'EMAIL') return payer.email;
  return payer.telefono_whatsapp;
}

/** Encola una notificación por cada canal configurado para el que el pagador tenga contacto. */
export async function encolarParaPagador(db, { payerId, tenantId, plantilla, payload }) {
  const { rows } = await db.query('SELECT email, telefono_whatsapp FROM payers WHERE id = $1', [payerId]);
  const payer = rows[0];
  if (!payer) return 0;

  let encoladas = 0;
  for (const canal of env.notificaciones.canales) {
    const destinatario = destinatarioPorCanal(payer, canal);
    if (!destinatario) continue;
    await db.query(
      `INSERT INTO notifications (tenant_id, payer_id, destinatario, canal, plantilla, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId ?? null, payerId, destinatario, canal, plantilla, payload]
    );
    encoladas++;
  }
  return encoladas;
}

export async function encolarParaAdministradores(db, { tenantId, plantilla, payload }) {
  const { rowCount } = await db.query(
    `INSERT INTO notifications (tenant_id, destinatario, canal, plantilla, payload_json)
     SELECT tenant_id, email, 'EMAIL', $2, $3 FROM tenant_admin_users WHERE tenant_id = $1 AND activo`,
    [tenantId, plantilla, payload]
  );
  return rowCount;
}
