import 'dotenv/config';

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (Number.isNaN(value)) throw new Error(`[config] ${name} debe ser numérico`);
  return value;
}

function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

function list(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

export const env = {
  nodeEnv,
  isProduction,
  port: num('PORT', 3001),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  timezone: process.env.TZ_NEGOCIO ?? 'America/Lima',
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: num('DB_PORT', 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  otpPepper: process.env.OTP_PEPPER,

  login: {
    maxIntentos: num('LOGIN_MAX_INTENTOS', 5),
    bloqueoMinutos: num('LOGIN_BLOQUEO_MINUTOS', 15),
  },
  otp: {
    ttlMinutos: num('OTP_TTL_MINUTOS', 5),
    maxIntentos: num('OTP_MAX_INTENTOS', 3),
    reenvioSegundos: num('OTP_REENVIO_SEGUNDOS', 60),
    devEcho: !isProduction && bool('OTP_DEV_ECHO'),
  },
  pagos: {
    timeoutMinutos: num('PAGO_TIMEOUT_MINUTOS', 30),
    cipVigenciaHoras: num('CIP_VIGENCIA_HORAS', 24),
    igvTasa: num('IGV_TASA', 0.18),
    pasarelaPorMetodo: {
      YAPE: process.env.PASARELA_YAPE ?? 'mock',
      CARD: process.env.PASARELA_CARD ?? 'mock',
      CIP: process.env.PASARELA_CIP ?? 'mock',
    },
  },
  gateways: {
    mock: {
      webhookSecret: process.env.WEBHOOK_SECRET_MOCK,
      comisionFija: num('MOCK_COMISION_FIJA', 0),
      comisionPorcentaje: num('MOCK_COMISION_PORCENTAJE', 0),
    },
  },
  payLinks: {
    baseUrl: process.env.PAY_LINK_BASE_URL ?? 'http://localhost:5173/pagar/',
    ttlHoras: num('PAY_LINK_TTL_HORAS', 72),
    checkoutTtlMinutos: num('PAY_LINK_CHECKOUT_TTL_MINUTOS', 15),
  },
  notificaciones: {
    canales: list('NOTIFICACIONES_CANALES', ['WHATSAPP', 'EMAIL']),
    maxIntentos: num('NOTIFICACIONES_MAX_INTENTOS', 5),
  },
  devRoutes: !isProduction && bool('ENABLE_DEV_ROUTES'),
};

const required = {
  DB_USER: env.db.user,
  DB_PASSWORD: env.db.password,
  DB_NAME: env.db.database,
  JWT_SECRET: env.jwtSecret,
  OTP_PEPPER: env.otpPepper,
};
for (const [name, value] of Object.entries(required)) {
  if (!value) throw new Error(`[config] falta la variable de entorno ${name}`);
}
if (isProduction && env.jwtSecret.length < 32) {
  throw new Error('[config] JWT_SECRET debe tener al menos 32 caracteres en producción');
}
