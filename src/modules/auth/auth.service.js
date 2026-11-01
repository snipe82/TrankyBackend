import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../shared/errors.js';
import { audit } from '../../shared/audit.js';
import { hmacSha256, randomDigits, randomToken, timingSafeEqualHex } from '../../shared/security.js';
import { signAdminToken, signPayerToken } from '../../middleware/auth.js';
import { getProvider } from '../notifications/providers.js';

export const BCRYPT_ROUNDS = 12;
// Hash aleatorio para comparar cuando el usuario no existe y no revelar su existencia por tiempo de respuesta.
const DUMMY_HASH = bcrypt.hashSync(randomToken(), BCRYPT_ROUNDS);

const credencialesInvalidas = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Documento o credenciales incorrectos');
const otpInvalido = () =>
  new AppError(401, 'OTP_INVALID', 'Código inválido o vencido. Solicita un nuevo código.');
const bloqueado = () =>
  new AppError(429, 'ACCOUNT_LOCKED', 'Demasiados intentos fallidos. Intenta nuevamente más tarde.');

const hashOtp = (payerId, codigo) => hmacSha256(env.otpPepper, `${payerId}:${codigo}`);

async function registrarFallo(table, id) {
  await pool.query(
    `UPDATE ${table}
        SET intentos_fallidos = CASE WHEN intentos_fallidos + 1 >= $2 THEN 0 ELSE intentos_fallidos + 1 END,
            bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= $2 THEN NOW() + make_interval(mins => $3) ELSE bloqueado_hasta END
      WHERE id = $1`,
    [id, env.login.maxIntentos, env.login.bloqueoMinutos]
  );
}

const estaBloqueado = (row) => row?.bloqueado_hasta && new Date(row.bloqueado_hasta) > new Date();

function presentarPagador(p) {
  return { id: p.id, tipo_doc: p.tipo_doc, num_doc: p.num_doc, nombres: p.nombres, apellidos: p.apellidos, tiene_password: Boolean(p.password_hash) };
}

async function sesionPagador(payer, req, metodo) {
  await pool.query('UPDATE payers SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1', [payer.id]);
  await audit(pool, { req, actorTipo: 'PAYER', actorId: payer.id, accion: 'LOGIN_OK', detalle: { metodo } });
  return { token: signPayerToken(payer.id), token_type: 'Bearer', expires_in: env.jwtExpiresIn, pagador: presentarPagador(payer) };
}

/** RF-R-01: login con documento + contraseña o documento + OTP. */
export async function loginPagador({ tipo_doc, num_doc, password, otp }, req) {
  const { rows } = await pool.query('SELECT * FROM payers WHERE tipo_doc = $1 AND num_doc = $2', [tipo_doc, num_doc]);
  const payer = rows[0];

  if (estaBloqueado(payer)) throw bloqueado();

  if (password !== undefined) {
    const ok = await bcrypt.compare(password, payer?.password_hash ?? DUMMY_HASH);
    if (!payer || !payer.password_hash || !ok) {
      if (payer) {
        await registrarFallo('payers', payer.id);
        await audit(pool, { req, actorTipo: 'PAYER', actorId: payer.id, accion: 'LOGIN_FALLIDO', detalle: { metodo: 'PASSWORD' } });
      }
      throw credencialesInvalidas();
    }
    return sesionPagador(payer, req, 'PASSWORD');
  }

  if (!payer) throw otpInvalido();
  const valido = await withTransaction(async (client) => {
    const { rows: challenges } = await client.query(
      `SELECT * FROM otp_challenges
        WHERE payer_id = $1 AND usado_en IS NULL AND invalidado_en IS NULL AND expira_en > NOW()
        ORDER BY created_at DESC LIMIT 1
        FOR UPDATE`,
      [payer.id]
    );
    const challenge = challenges[0];
    if (!challenge) return false;

    if (!timingSafeEqualHex(challenge.codigo_hash, hashOtp(payer.id, otp))) {
      const intentos = challenge.intentos + 1;
      await client.query(
        `UPDATE otp_challenges SET intentos = $2, invalidado_en = CASE WHEN $2 >= $3 THEN NOW() END WHERE id = $1`,
        [challenge.id, intentos, env.otp.maxIntentos]
      );
      return false;
    }
    await client.query('UPDATE otp_challenges SET usado_en = NOW() WHERE id = $1', [challenge.id]);
    return true;
  });

  if (!valido) {
    await audit(pool, { req, actorTipo: 'PAYER', actorId: payer.id, accion: 'LOGIN_FALLIDO', detalle: { metodo: 'OTP' } });
    throw otpInvalido();
  }
  return sesionPagador(payer, req, 'OTP');
}

const RESPUESTA_OTP = 'Si el documento está registrado, enviaremos un código a tu teléfono.';

/** Envía un OTP por WhatsApp o SMS. La respuesta es la misma exista o no el documento. */
export async function solicitarOtp({ tipo_doc, num_doc, canal }, req) {
  const { rows } = await pool.query('SELECT id, telefono_whatsapp, bloqueado_hasta FROM payers WHERE tipo_doc = $1 AND num_doc = $2', [tipo_doc, num_doc]);
  const payer = rows[0];
  if (!payer || !payer.telefono_whatsapp || estaBloqueado(payer)) return { mensaje: RESPUESTA_OTP };

  const { rows: recientes } = await pool.query(
    `SELECT 1 FROM otp_challenges WHERE payer_id = $1 AND created_at > NOW() - make_interval(secs => $2)`,
    [payer.id, env.otp.reenvioSegundos]
  );
  if (recientes.length) return { mensaje: RESPUESTA_OTP };

  const codigo = randomDigits(6);
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE otp_challenges SET invalidado_en = NOW() WHERE payer_id = $1 AND usado_en IS NULL AND invalidado_en IS NULL`,
      [payer.id]
    );
    await client.query(
      `INSERT INTO otp_challenges (payer_id, codigo_hash, canal, expira_en)
       VALUES ($1, $2, $3, NOW() + make_interval(mins => $4))`,
      [payer.id, hashOtp(payer.id, codigo), canal, env.otp.ttlMinutos]
    );
  });

  await getProvider(canal).send({
    canal,
    destinatario: payer.telefono_whatsapp,
    mensaje: `Tranky: tu código de acceso es ${codigo}. Vence en ${env.otp.ttlMinutos} minutos. No lo compartas.`,
  });
  await audit(pool, { req, actorTipo: 'PAYER', actorId: payer.id, accion: 'OTP_SOLICITADO', detalle: { canal } });

  return { mensaje: RESPUESTA_OTP, ...(env.otp.devEcho ? { dev_otp: codigo } : {}) };
}

export async function cambiarPassword(payerId, { password_actual, password_nueva }, req) {
  const { rows } = await pool.query('SELECT password_hash FROM payers WHERE id = $1', [payerId]);
  const actual = rows[0]?.password_hash;
  if (actual && !(await bcrypt.compare(password_actual ?? '', actual))) {
    throw new AppError(400, 'INVALID_PASSWORD', 'La contraseña actual no es correcta');
  }
  const hash = await bcrypt.hash(password_nueva, BCRYPT_ROUNDS);
  await pool.query('UPDATE payers SET password_hash = $2 WHERE id = $1', [payerId, hash]);
  await audit(pool, { req, accion: 'PASSWORD_ACTUALIZADA', entidad: 'payers', entidadId: payerId });
}

export async function loginAdministrador({ email, password }, req) {
  const { rows } = await pool.query(
    `SELECT u.*, t.estado AS tenant_estado
       FROM tenant_admin_users u JOIN tenants t ON t.id = u.tenant_id
      WHERE lower(u.email) = lower($1)`,
    [email]
  );
  const admin = rows[0];
  if (estaBloqueado(admin)) throw bloqueado();

  const ok = await bcrypt.compare(password, admin?.password_hash ?? DUMMY_HASH);
  if (!admin || !ok || !admin.activo || admin.tenant_estado !== 'ACTIVO') {
    if (admin) {
      await registrarFallo('tenant_admin_users', admin.id);
      await audit(pool, { req, actorTipo: 'TENANT_ADMIN', actorId: admin.id, tenantId: admin.tenant_id, accion: 'LOGIN_FALLIDO' });
    }
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos');
  }

  await pool.query('UPDATE tenant_admin_users SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1', [admin.id]);
  await audit(pool, { req, actorTipo: 'TENANT_ADMIN', actorId: admin.id, tenantId: admin.tenant_id, accion: 'LOGIN_OK' });
  return {
    token: signAdminToken(admin),
    token_type: 'Bearer',
    expires_in: env.jwtExpiresIn,
    administrador: { id: admin.id, email: admin.email, nombres: admin.nombres, tenant_id: admin.tenant_id },
  };
}
