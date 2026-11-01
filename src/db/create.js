import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bootstrapPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../db/bootstrap.sql');
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

function required(name, { identifier = false } = {}) {
  const value = process.env[name];
  if (!value) throw new Error(`[db:create] falta la variable de entorno ${name}`);
  if (identifier && !IDENTIFIER.test(value)) throw new Error(`[db:create] ${name} debe ser un identificador en minúsculas (a-z, 0-9, _)`);
  return value;
}

const psqlLiteral = (value) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

const container = required('DOCKER_DB_CONTAINER');
const adminUser = required('DOCKER_DB_ADMIN_USER', { identifier: true });
const vars = {
  db_user: required('DB_USER', { identifier: true }),
  db_password: required('DB_PASSWORD'),
  db_name: required('DB_NAME', { identifier: true }),
  db_name_test: required('DB_NAME_TEST', { identifier: true }),
};

// Los valores viajan por stdin (no por argumentos) para que la contraseña no aparezca en la lista de procesos.
const input =
  Object.entries(vars)
    .map(([key, value]) => `\\set ${key} ${psqlLiteral(value)}`)
    .join('\n') +
  '\n' +
  fs.readFileSync(bootstrapPath, 'utf8');

const result = spawnSync(
  'docker',
  ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-U', adminUser, '-d', 'postgres'],
  { input, stdio: ['pipe', 'inherit', 'inherit'] }
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`[db:create] rol ${vars.db_user} y bases ${vars.db_name} / ${vars.db_name_test} listas en ${container}`);
