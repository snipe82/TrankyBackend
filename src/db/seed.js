import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { pool, withTransaction } from './pool.js';
import { recalcularMora } from '../modules/debts/mora.service.js';
import { isMainModule } from '../shared/isMain.js';

function seedPassword(name) {
  const value = process.env[name];
  if (!value) throw new Error(`[seed] falta la variable de entorno ${name}`);
  return value;
}

// Datos de ejemplo para desarrollo. Montos, comisiones y reglas de mora son ilustrativos.
export const SEED = {
  password: seedPassword('SEED_PASSWORD_RESIDENTES'),
  adminPassword: seedPassword('SEED_PASSWORD_ADMIN'),
  tenants: { tranquila: 'a1000000-0000-4000-8000-000000000001', limaNorte: 'a2000000-0000-4000-8000-000000000002' },
  edificios: { pinos: 'b1000000-0000-4000-8000-000000000001', mirador: 'b2000000-0000-4000-8000-000000000002' },
  unidades: {
    dpto402: 'c1000000-0000-4000-8000-000000000402',
    dep12: 'c1000000-0000-4000-8000-000000000012',
    coch07: 'c1000000-0000-4000-8000-000000000007',
    dpto501: 'c1000000-0000-4000-8000-000000000501',
    dpto1201: 'c2000000-0000-4000-8000-000000001201',
  },
  pagadores: {
    juan: 'd0000000-0000-4000-8000-000000000001',
    maria: 'd0000000-0000-4000-8000-000000000002',
    carla: 'd0000000-0000-4000-8000-000000000003',
    luis: 'd0000000-0000-4000-8000-000000000004',
  },
};

function fechas() {
  const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: env.timezone }));
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const periodo = (offset) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - offset, 1);
    return iso(d).slice(0, 7);
  };
  const dia15 = (offset) => iso(new Date(hoy.getFullYear(), hoy.getMonth() - offset, 15));
  const enDias = (n) => iso(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + n));
  return { m0: periodo(0), m1: periodo(1), m2: periodo(2), venceM1: dia15(1), venceM2: dia15(2), enDias };
}

const ITEMS_ORDINARIA = [
  { item: 'Limpieza', monto: 80 },
  { item: 'Vigilancia', monto: 150 },
  { item: 'Agua común', monto: 45 },
  { item: 'Fondo de reserva', monto: 25 },
];

export async function seed() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM tenants');
  if (rows[0].n > 0) {
    console.log('[seed] la base ya tiene datos; usa npm run db:reset para recrearla');
    return;
  }

  const hashPagador = await bcrypt.hash(SEED.password, 12);
  const hashAdmin = await bcrypt.hash(SEED.adminPassword, 12);
  const f = fechas();
  const { tenants: T, edificios: E, unidades: U, pagadores: P } = SEED;

  await withTransaction(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, ruc, razon_social, nombre_comercial, rubro, config_comision_json) VALUES
       ($1, '20601234567', 'Administradora Tranquila S.A.C.', 'Tranquila Administraciones', 'INMOBILIARIO',
        '{"tipo": "MIXTO", "fijo": 1.00, "porcentaje": 0.01, "asume": "PAGADOR"}'),
       ($2, '20509876543', 'Gestión Inmobiliaria Lima Norte S.A.C.', 'Lima Norte Gestión', 'INMOBILIARIO',
        '{"tipo": "FIJO", "fijo": 1.50, "porcentaje": 0, "asume": "TENANT"}')`,
      [T.tranquila, T.limaNorte]
    );

    const { rows: cuentas } = await c.query(
      `INSERT INTO bank_accounts (tenant_id, banco, cci, titular) VALUES
       ($1, 'BCP', '00219300123456789012', 'Junta de Propietarios Residencial Los Pinos'),
       ($2, 'Interbank', '00310300987654321098', 'Junta de Propietarios Edificio Mirador del Parque')
       RETURNING id`,
      [T.tranquila, T.limaNorte]
    );

    await c.query(
      `INSERT INTO organization_units (id, tenant_id, nombre, direccion, moneda_base, bank_account_id, config_json) VALUES
       ($1, $2, 'Residencial Los Pinos – Torre A', 'Av. Javier Prado Este 1234, San Isidro', 'PEN', $3,
        '{"mora": {"tipo": "INTERES_DIARIO", "valor": 0.1, "dias_gracia": 3, "tope": 50}}'),
       ($4, $5, 'Edificio Mirador del Parque', 'Jr. Las Begonias 456, Jesús María', 'PEN', $6,
        '{"mora": {"tipo": "PENALIDAD_FIJA", "valor": 20, "dias_gracia": 0, "tope": null}}')`,
      [E.pinos, T.tranquila, cuentas[0].id, E.mirador, T.limaNorte, cuentas[1].id]
    );

    await c.query(
      `INSERT INTO billing_units (id, tenant_id, organization_unit_id, tipo_unidad, codigo_interno, alias, metadata_json) VALUES
       ($1, $6, $7, 'DEPARTAMENTO', 'DPTO-402', 'Dpto 402', '{"tipo":"DEPARTAMENTO","piso":4,"numero":"402","area_m2":85.5,"alicuota":1.25,"dormitorios":3}'),
       ($2, $6, $7, 'DEPOSITO', 'DEP-S1-12', 'Depósito 12', '{"tipo":"DEPOSITO","nivel":"S1","numero":"12","area_m2":4.0,"alicuota":0.10}'),
       ($3, $6, $7, 'COCHERA', 'COCH-S2-07', 'Cochera 07', '{"tipo":"COCHERA","nivel":"S2","numero":"07","techada":true,"area_m2":12.5,"alicuota":0.30}'),
       ($4, $6, $7, 'DEPARTAMENTO', 'DPTO-501', 'Dpto 501', '{"tipo":"DEPARTAMENTO","piso":5,"numero":"501","area_m2":90,"alicuota":1.30,"dormitorios":3}'),
       ($5, $8, $9, 'DEPARTAMENTO', 'DPTO-1201', 'Dpto 1201', '{"tipo":"DEPARTAMENTO","piso":12,"numero":"1201","area_m2":110,"alicuota":2.10,"dormitorios":4}')`,
      [U.dpto402, U.dep12, U.coch07, U.dpto501, U.dpto1201, T.tranquila, E.pinos, T.limaNorte, E.mirador]
    );

    await c.query(
      `INSERT INTO payers (id, tipo_doc, num_doc, nombres, apellidos, email, telefono_whatsapp, password_hash) VALUES
       ($1, 'DNI', '45678901', 'Juan', 'Pérez Salas', 'juan.perez@example.com', '51987654321', $5),
       ($2, 'DNI', '41234567', 'María', 'Torres Vega', 'maria.torres@example.com', '51912345678', $5),
       ($3, 'DNI', '47890123', 'Carla', 'Ríos Medina', 'carla.rios@example.com', '51998877665', $5),
       ($4, 'DNI', '40011122', 'Luis', 'Gómez Paredes', NULL, '51955544433', $5)`,
      [P.juan, P.maria, P.carla, P.luis, hashPagador]
    );

    await c.query(
      `INSERT INTO unit_payer_relations (tenant_id, billing_unit_id, payer_id, rol, activo, fecha_fin) VALUES
       ($1, $3, $8, 'PROPIETARIO', TRUE, NULL),
       ($1, $4, $8, 'PROPIETARIO', TRUE, NULL),
       ($1, $5, $8, 'PROPIETARIO', TRUE, NULL),
       ($2, $7, $8, 'PROPIETARIO', TRUE, NULL),
       ($1, $3, $9, 'INQUILINO', TRUE, NULL),
       ($1, $6, $10, 'PROPIETARIO', TRUE, NULL),
       ($1, $6, $11, 'INQUILINO', FALSE, CURRENT_DATE - 30)`,
      [T.tranquila, T.limaNorte, U.dpto402, U.dep12, U.coch07, U.dpto501, U.dpto1201, P.juan, P.maria, P.carla, P.luis]
    );

    await c.query(
      `INSERT INTO tenant_admin_users (tenant_id, email, password_hash, nombres) VALUES
       ($1, 'admin@tranquila.pe', $3, 'Rosa Quispe'),
       ($2, 'admin@limanorte.pe', $3, 'Jorge Huamán')`,
      [T.tranquila, T.limaNorte, hashAdmin]
    );

    const cuota = (tenant, unidad, periodo, concepto, tipo, vence, items) =>
      c.query(
        `INSERT INTO debts (tenant_id, billing_unit_id, periodo, concepto_principal, tipo_cuota, moneda, fecha_emision,
                            fecha_vencimiento, monto_base, detalle_items_json)
         VALUES ($1, $2, $3, $4, $5, 'PEN', LEAST(CURRENT_DATE, $6::date - 10), $6, $7, $8)`,
        [tenant, unidad, periodo, concepto, tipo, vence, items.reduce((a, i) => a + i.monto, 0), JSON.stringify(items)]
      );

    await cuota(T.tranquila, U.dpto402, f.m2, `Mantenimiento ${f.m2}`, 'ORDINARIA', f.venceM2, ITEMS_ORDINARIA);
    await cuota(T.tranquila, U.dpto402, f.m1, `Mantenimiento ${f.m1}`, 'ORDINARIA', f.venceM1, ITEMS_ORDINARIA);
    await cuota(T.tranquila, U.dpto402, f.m0, `Mantenimiento ${f.m0}`, 'ORDINARIA', f.enDias(7), ITEMS_ORDINARIA);
    await cuota(T.tranquila, U.dpto402, f.m0, 'Cambio de ascensor (cuota 1 de 3)', 'EXTRAORDINARIA', f.enDias(20), [
      { item: 'Cambio de ascensor', monto: 250 },
    ]);
    await cuota(T.tranquila, U.dep12, f.m0, `Mantenimiento ${f.m0}`, 'ORDINARIA', f.enDias(7), [{ item: 'Mantenimiento depósito', monto: 30 }]);
    await cuota(T.tranquila, U.coch07, f.m0, `Mantenimiento ${f.m0}`, 'ORDINARIA', f.enDias(7), [
      { item: 'Mantenimiento cochera', monto: 40 },
      { item: 'Limpieza sótano', monto: 10 },
    ]);
    await cuota(T.tranquila, U.dpto501, f.m0, `Mantenimiento ${f.m0}`, 'ORDINARIA', f.enDias(7), [
      ...ITEMS_ORDINARIA.slice(0, 3),
      { item: 'Fondo de reserva', monto: 45 },
    ]);
    await cuota(T.limaNorte, U.dpto1201, f.m1, `Mantenimiento ${f.m1}`, 'ORDINARIA', f.venceM1, [{ item: 'Mantenimiento', monto: 400 }]);
    await cuota(T.limaNorte, U.dpto1201, f.m0, `Mantenimiento ${f.m0}`, 'ORDINARIA', f.enDias(7), [{ item: 'Mantenimiento', monto: 400 }]);

    await recalcularMora(c);
  });

  console.log('[seed] datos de ejemplo cargados');
  console.log('  Residentes (contraseña SEED_PASSWORD_RESIDENTES): DNI 45678901 Juan, 41234567 María, 47890123 Carla');
  console.log('  Administradoras (contraseña SEED_PASSWORD_ADMIN): admin@tranquila.pe, admin@limanorte.pe');
}

if (isMainModule(import.meta.url)) {
  seed()
    .catch((err) => {
      console.error('[seed] falló', err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
