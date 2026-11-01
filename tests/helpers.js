import crypto from 'node:crypto';

import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DB_NAME = process.env.DB_NAME_TEST ?? 'tranky_test';

const { env } = await import('../src/config/env.js');
const { pool } = await import('../src/db/pool.js');
const { resetSchema } = await import('../src/db/reset.js');
const { migrate } = await import('../src/db/migrate.js');
const { seed, SEED } = await import('../src/db/seed.js');
const { createApp } = await import('../src/app.js');

export { env, pool, SEED };

let server;
let baseUrl;

export async function iniciar() {
  await resetSchema();
  await migrate();
  await seed();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
}

export async function detener() {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}

export async function api(method, path, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}

export async function loginPagador(numDoc, password = SEED.password) {
  const { status, data } = await api('POST', '/auth/login', { body: { tipo_doc: 'DNI', num_doc: numDoc, password } });
  if (status !== 200) throw new Error(`login ${numDoc} falló: ${JSON.stringify(data)}`);
  return data.token;
}

export async function loginAdmin(email) {
  const { status, data } = await api('POST', '/auth/admin/login', { body: { email, password: SEED.adminPassword } });
  if (status !== 200) throw new Error(`login admin ${email} falló: ${JSON.stringify(data)}`);
  return data.token;
}

export const nuevaClave = () => `test-${crypto.randomUUID()}`;

export function webhookFirmado(payload) {
  const rawBody = JSON.stringify(payload);
  const firma = crypto.createHmac('sha256', env.gateways.mock.webhookSecret).update(rawBody).digest('hex');
  return { rawBody, headers: { 'Content-Type': 'application/json', 'x-mock-signature': firma } };
}

export async function cuotasDeUnidad(token, unitId, status) {
  const qs = status ? `?status=${status}` : '';
  const { data } = await api('GET', `/payer/units/${unitId}/debts${qs}`, { token });
  return data.cuotas;
}
