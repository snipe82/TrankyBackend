import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  api,
  cuotasDeUnidad,
  detener,
  iniciar,
  loginAdmin,
  loginPagador,
  nuevaClave,
  pool,
  SEED,
  webhookFirmado,
} from './helpers.js';

const { unidades: U, pagadores: P } = SEED;
const { crearPayLink } = await import('../src/modules/payLinks/payLinks.service.js');
const { expirarIntentos } = await import('../src/modules/payments/expiration.job.js');
const { procesarNotificaciones } = await import('../src/modules/notifications/dispatcher.js');

let juan;
let maria;

before(async () => {
  await iniciar();
  juan = await loginPagador('45678901');
  maria = await loginPagador('41234567');
});
after(detener);

const yape = (otp = '123456') => ({ metodo_pago: 'YAPE', yape: { celular: '987654321', otp } });

async function estadoCuota(id) {
  const { rows } = await pool.query('SELECT estado FROM debts WHERE id = $1', [id]);
  return rows[0].estado;
}

async function confirmarPorWebhook(transactionId) {
  const { rows } = await pool.query('SELECT pasarela_tx_id, monto_total_cobrado FROM transactions WHERE id = $1', [transactionId]);
  const payload = {
    id: `evt_${transactionId}`,
    type: 'charge.succeeded',
    data: { charge_id: rows[0].pasarela_tx_id, reference: transactionId, amount: Math.round(Number(rows[0].monto_total_cobrado) * 100), currency: 'PEN' },
  };
  const { rawBody, headers } = webhookFirmado(payload);
  return { respuesta: await api('POST', '/webhooks/gateway/mock', { raw: rawBody, headers }), rawBody, headers };
}

describe('RF-R-01 inicio de sesión', () => {
  test('credenciales inválidas y documento inexistente devuelven el mismo mensaje genérico', async () => {
    const malaClave = await api('POST', '/auth/login', { body: { tipo_doc: 'DNI', num_doc: '45678901', password: 'incorrecta' } });
    const inexistente = await api('POST', '/auth/login', { body: { tipo_doc: 'DNI', num_doc: '99999999', password: 'x' } });
    assert.equal(malaClave.status, 401);
    assert.equal(inexistente.status, 401);
    assert.equal(malaClave.data.error.message, inexistente.data.error.message);
  });

  test('login por OTP; un OTP ya usado se rechaza', async () => {
    const otp = await api('POST', '/auth/otp', { body: { tipo_doc: 'DNI', num_doc: '47890123', canal: 'WHATSAPP' } });
    assert.equal(otp.status, 202);
    assert.match(otp.data.dev_otp, /^\d{6}$/);

    const body = { tipo_doc: 'DNI', num_doc: '47890123', otp: otp.data.dev_otp };
    const ok = await api('POST', '/auth/login', { body });
    assert.equal(ok.status, 200);
    assert.ok(ok.data.token);

    const reuso = await api('POST', '/auth/login', { body });
    assert.equal(reuso.status, 401);
    assert.equal(reuso.data.error.code, 'OTP_INVALID');
  });

  test('la contraseña nunca se guarda en texto plano', async () => {
    const { rows } = await pool.query('SELECT password_hash FROM payers WHERE id = $1', [P.juan]);
    assert.match(rows[0].password_hash, /^\$2[aby]\$12\$/);
  });
});

describe('RF-R-02 / RF-R-04 unidades y propiedades', () => {
  test('propietario ve departamento, depósito y cochera agrupados por edificio y tipo', async () => {
    const { data } = await api('GET', '/payer/units', { token: juan });
    assert.equal(data.total_unidades, 4);
    assert.equal(data.seleccion_requerida, true);
    const pinos = data.edificios.find((e) => e.id === SEED.edificios.pinos);
    assert.deepEqual(pinos.tipos.map((t) => t.tipo_unidad), ['DEPARTAMENTO', 'DEPOSITO', 'COCHERA']);
  });

  test('inquilino con relación desactivada no ve la unidad', async () => {
    const luis = await loginPagador('40011122');
    const { data } = await api('GET', '/payer/units', { token: luis });
    assert.equal(data.total_unidades, 0);
  });

  test('Mis propiedades: dos edificios con subtotales y cochera techada', async () => {
    const { data } = await api('GET', '/payer/properties', { token: juan });
    assert.equal(data.edificios.length, 2);
    data.edificios.forEach((e) => assert.ok(e.subtotal.length > 0));
    const cochera = data.edificios.flatMap((e) => e.tipos).flatMap((t) => t.unidades).find((u) => u.id === U.coch07);
    assert.match(cochera.descripcion, /Cochera techada/);
  });

  test('reportar dato incorrecto notifica a la administradora sin editar la unidad', async () => {
    const res = await api('POST', `/payer/units/${U.coch07}/data-issues`, { token: juan, body: { descripcion: 'El área de la cochera es 13 m²' } });
    assert.equal(res.status, 201);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE plantilla = 'DATO_INCORRECTO'`);
    assert.equal(rows[0].n, 1);
  });
});

describe('RF-R-03 / RF-R-05 cuotas y permisos por rol', () => {
  test('cuotas ordenadas por vencimiento con desglose que suma monto_base', async () => {
    const cuotas = await cuotasDeUnidad(juan, U.dpto402);
    assert.equal(cuotas.length, 4);
    const fechas = cuotas.map((c) => c.fecha_vencimiento);
    assert.deepEqual(fechas, [...fechas].sort());
    for (const c of cuotas) {
      const suma = c.detalle_items.reduce((a, i) => a + Math.round(i.monto * 100), 0);
      assert.equal(suma, Math.round(Number(c.monto_base) * 100));
    }
    const vencida = cuotas.find((c) => c.estado === 'VENCIDO');
    assert.ok(Number(vencida.monto_mora) > 0);
    assert.equal(Number(vencida.monto_total), Number(vencida.monto_base) + Number(vencida.monto_mora));
  });

  test('la inquilina no ve la cuota extraordinaria (regla por defecto P-01)', async () => {
    const cuotas = await cuotasDeUnidad(maria, U.dpto402);
    assert.equal(cuotas.length, 3);
    assert.ok(cuotas.every((c) => c.tipo_cuota === 'ORDINARIA'));
  });

  test('dashboard separa deuda total y vencida por moneda', async () => {
    const { data } = await api('GET', '/payer/debts?scope=all', { token: juan });
    const pen = data.resumen.find((r) => r.moneda === 'PEN');
    assert.equal(data.estas_al_dia, false);
    assert.ok(Number(pen.saldo_vencido) > 0);
    assert.equal(Number(pen.deuda_total), Number(pen.saldo_pendiente) + Number(pen.saldo_vencido));
  });

  test('aviso de cobranza en PDF', async () => {
    const [cuota] = await cuotasDeUnidad(juan, U.dep12);
    const res = await api('GET', `/payer/debts/${cuota.id}/notice.pdf`, { token: juan });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal(res.data.subarray(0, 4).toString(), '%PDF');
  });
});

describe('RF-R-07 / RF-R-08 checkout multi-cuota y webhook', () => {
  let transactionId;
  let vencidas;

  test('dos cuotas -> 202 EN_PROCESO, dos filas en transaction_debts y monto calculado en backend', async () => {
    vencidas = (await cuotasDeUnidad(juan, U.dpto402)).filter((c) => c.estado === 'VENCIDO');
    assert.equal(vencidas.length, 2);
    const key = nuevaClave();
    const res = await api('POST', '/payments/checkout', {
      token: juan,
      headers: { 'Idempotency-Key': key },
      body: { debt_ids: vencidas.map((c) => c.id), ...yape(), monto_total: '1.00' },
    });
    assert.equal(res.status, 202, JSON.stringify(res.data));
    assert.equal(res.data.estado, 'EN_PROCESO');
    transactionId = res.data.transaction_id;

    const deuda = vencidas.reduce((a, c) => a + Math.round(Number(c.monto_total) * 100), 0);
    const comision = 100 + Math.round(deuda * 0.01);
    const igv = Math.round(comision * 0.18);
    assert.equal(Math.round(Number(res.data.monto_total ?? res.data.resumen.monto_total) * 100), deuda + comision + igv);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM transaction_debts WHERE transaction_id = $1', [transactionId]);
    assert.equal(rows[0].n, 2);
    for (const c of vencidas) assert.equal(await estadoCuota(c.id), 'EN_PROCESO');

    const replay = await api('POST', '/payments/checkout', {
      token: juan,
      headers: { 'Idempotency-Key': key },
      body: { debt_ids: vencidas.map((c) => c.id), ...yape() },
    });
    assert.equal(replay.data.transaction_id, transactionId);

    const otroCuerpo = await api('POST', '/payments/checkout', {
      token: juan,
      headers: { 'Idempotency-Key': key },
      body: { debt_ids: [vencidas[0].id], ...yape() },
    });
    assert.equal(otroCuerpo.status, 422);
  });

  test('sin Idempotency-Key se rechaza', async () => {
    const res = await api('POST', '/payments/checkout', { token: juan, body: { debt_ids: [vencidas[0].id], ...yape() } });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  });

  test('webhook con firma inválida se rechaza y no confirma el pago', async () => {
    const res = await api('POST', '/webhooks/gateway/mock', {
      raw: JSON.stringify({ id: 'evt_falso', type: 'charge.succeeded', data: { reference: transactionId } }),
      headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'deadbeef' },
    });
    assert.equal(res.status, 401);
    assert.equal(await estadoCuota(vencidas[0].id), 'EN_PROCESO');
  });

  test('webhook firmado -> PAGADO; reenvío del mismo evento se ignora', async () => {
    const { respuesta, rawBody, headers } = await confirmarPorWebhook(transactionId);
    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.data.resultado, 'APLICADO');
    for (const c of vencidas) assert.equal(await estadoCuota(c.id), 'PAGADO');

    const duplicado = await api('POST', '/webhooks/gateway/mock', { raw: rawBody, headers });
    assert.equal(duplicado.data.duplicado, true);

    const estado = await api('GET', `/payments/${transactionId}/status`, { token: juan });
    assert.equal(estado.data.estado, 'PAGADO');

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE plantilla = 'RECIBO_PAGO'`);
    assert.ok(rows[0].n >= 1);
  });

  test('historial con total histórico y comprobante PDF', async () => {
    const { data } = await api('GET', `/payer/units/${U.dpto402}/transactions`, { token: juan });
    assert.equal(data.pagos.length, 1);
    assert.equal(data.pagos[0].cuotas.length, 2);
    const esperado = vencidas.reduce((a, c) => a + Math.round(Number(c.monto_total) * 100), 0);
    assert.equal(Math.round(Number(data.total_historico_pagado[0].monto) * 100), esperado);

    const pdf = await api('GET', `/payer/transactions/${transactionId}/receipt.pdf`, { token: juan });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  });

  test('la inquilina ve solo sus propios pagos (historial PROPIOS por defecto)', async () => {
    const { data } = await api('GET', `/payer/units/${U.dpto402}/transactions`, { token: maria });
    assert.equal(data.pagos.length, 0);
    const pdf = await api('GET', `/payer/transactions/${transactionId}/receipt.pdf`, { token: maria });
    assert.equal(pdf.status, 404);
  });
});

describe('Regla crítica 2: bloqueo pesimista', () => {
  test('propietario e inquilina pagan la misma cuota a la vez: solo uno obtiene el bloqueo', async () => {
    const [cuota] = (await cuotasDeUnidad(juan, U.dpto402)).filter((c) => c.estado === 'PENDIENTE' && c.tipo_cuota === 'ORDINARIA');
    const intento = (token) =>
      api('POST', '/payments/checkout', { token, headers: { 'Idempotency-Key': nuevaClave() }, body: { debt_ids: [cuota.id], ...yape() } });
    const resultados = await Promise.all([intento(juan), intento(maria)]);
    const estados = resultados.map((r) => r.status).sort();
    assert.deepEqual(estados, [202, 409]);
    const rechazado = resultados.find((r) => r.status === 409);
    assert.equal(rechazado.data.error.message, 'Esta cuota tiene un pago en proceso');
  });

  test('la inquilina no puede pagar la cuota extraordinaria', async () => {
    const extra = (await cuotasDeUnidad(juan, U.dpto402)).find((c) => c.tipo_cuota === 'EXTRAORDINARIA');
    const res = await api('POST', '/payments/checkout', {
      token: maria,
      headers: { 'Idempotency-Key': nuevaClave() },
      body: { debt_ids: [extra.id], ...yape() },
    });
    assert.equal(res.status, 404);
  });

  test('no se pueden mezclar cuotas de edificios distintos', async () => {
    const [a] = await cuotasDeUnidad(juan, U.dep12);
    const [b] = await cuotasDeUnidad(juan, U.dpto1201);
    const res = await api('POST', '/payments/checkout', {
      token: juan,
      headers: { 'Idempotency-Key': nuevaClave() },
      body: { debt_ids: [a.id, b.id], ...yape() },
    });
    assert.equal(res.status, 422);
    assert.equal(res.data.error.code, 'MIXED_CHECKOUT');
    assert.equal(await estadoCuota(a.id), 'PENDIENTE');
  });
});

describe('RF-R-08 / RF-R-09 / RF-R-10 métodos de pago', () => {
  test('Yape con OTP rechazado libera las cuotas', async () => {
    const [cuota] = await cuotasDeUnidad(juan, U.coch07);
    const res = await api('POST', '/payments/checkout', {
      token: juan,
      headers: { 'Idempotency-Key': nuevaClave() },
      body: { debt_ids: [cuota.id], ...yape('000000') },
    });
    assert.equal(res.status, 402);
    assert.equal(await estadoCuota(cuota.id), 'PENDIENTE');
  });

  test('OTP de Yape con 5 dígitos no pasa la validación', async () => {
    const [cuota] = await cuotasDeUnidad(juan, U.coch07);
    const res = await api('POST', '/payments/checkout', {
      token: juan,
      headers: { 'Idempotency-Key': nuevaClave() },
      body: { debt_ids: [cuota.id], ...yape('12345') },
    });
    assert.equal(res.status, 400);
  });

  test('nunca se acepta un número de tarjeta en lugar del token', async () => {
    const [cuota] = await cuotasDeUnidad(juan, U.coch07);
    const res = await api('POST', '/payments/checkout', {
      token: juan,
      headers: { 'Idempotency-Key': nuevaClave() },
      body: { debt_ids: [cuota.id], metodo_pago: 'CARD', card: { token_id: '4111111111111111' } },
    });
    assert.equal(res.status, 400);
  });

  test('CIP vigente reserva la cuota y al expirar la libera', async () => {
    const [cuota] = await cuotasDeUnidad(juan, U.dep12);
    const res = await api('POST', '/payments/checkout', {
      token: juan,
      headers: { 'Idempotency-Key': nuevaClave() },
      body: { debt_ids: [cuota.id], metodo_pago: 'CIP' },
    });
    assert.equal(res.status, 202);
    assert.match(res.data.cip.codigo, /^\d{9}$/);
    assert.equal(await estadoCuota(cuota.id), 'EN_PROCESO');

    await pool.query(`UPDATE transactions SET expira_en = NOW() - INTERVAL '1 minute' WHERE id = $1`, [res.data.transaction_id]);
    const resultado = await expirarIntentos();
    assert.ok(resultado.expiradas >= 1);
    assert.equal(await estadoCuota(cuota.id), 'PENDIENTE');
  });
});

describe('RF-R-11 billetera', () => {
  test('agregar tarjeta tokenizada y exigir confirmación si tiene débito automático', async () => {
    const alta = await api('POST', '/payer/payment-methods', {
      token: juan,
      body: { token_id: 'tkn_visa_juan_0001', marca: 'VISA', ultimos_4_digitos: '4242', debito_automatico_activo: true },
    });
    assert.equal(alta.status, 201);
    assert.equal(alta.data.es_predeterminado, true);
    assert.equal(alta.data.token_id, undefined);

    const sinConfirmar = await api('DELETE', `/payer/payment-methods/${alta.data.id}`, { token: juan });
    assert.equal(sinConfirmar.status, 409);
    const confirmado = await api('DELETE', `/payer/payment-methods/${alta.data.id}?confirmar=true`, { token: juan });
    assert.equal(confirmado.data.debito_automatico_desactivado, true);
    const lista = await api('GET', '/payer/payment-methods', { token: juan });
    assert.equal(lista.data.length, 0);
  });
});

describe('RF-R-14 link de pago por WhatsApp', () => {
  test('link de un solo uso: resuelve, paga solo su cuota y luego expira', async () => {
    const { rows } = await pool.query(`SELECT id, tenant_id FROM debts WHERE billing_unit_id = $1`, [U.dpto501]);
    const link = await crearPayLink(pool, { tenantId: rows[0].tenant_id, debtId: rows[0].id, payerId: P.carla });
    const token = link.url.split('/').pop();

    const resuelto = await api('GET', `/payer/pay-links/${token}`);
    assert.equal(resuelto.status, 200);
    assert.equal(resuelto.data.cuota.id, rows[0].id);
    const checkoutToken = resuelto.data.checkout_token;

    const [otraCuota] = await cuotasDeUnidad(juan, U.dep12);
    const fueraDeAlcance = await api('POST', '/payments/checkout', {
      token: checkoutToken,
      headers: { 'Idempotency-Key': nuevaClave() },
      body: { debt_ids: [otraCuota.id], ...yape() },
    });
    assert.equal(fueraDeAlcance.status, 403);

    const pago = await api('POST', '/payments/checkout', {
      token: checkoutToken,
      headers: { 'Idempotency-Key': nuevaClave() },
      body: { debt_ids: [rows[0].id], ...yape() },
    });
    assert.equal(pago.status, 202);
    await confirmarPorWebhook(pago.data.transaction_id);

    const reuso = await api('GET', `/payer/pay-links/${token}`);
    assert.equal(reuso.status, 410);
  });

  test('el token de link no da acceso al resto del portal', async () => {
    const { rows } = await pool.query(`SELECT id, tenant_id FROM debts WHERE billing_unit_id = $1 AND estado = 'PENDIENTE' LIMIT 1`, [U.coch07]);
    const link = await crearPayLink(pool, { tenantId: rows[0].tenant_id, debtId: rows[0].id, payerId: P.juan });
    const { data } = await api('GET', `/payer/pay-links/${link.url.split('/').pop()}`);
    const res = await api('GET', '/payer/units', { token: data.checkout_token });
    assert.equal(res.status, 403);
  });
});

describe('Regla crítica 3: ledger inmutable', () => {
  test('DELETE y cambio de montos en transactions están prohibidos en la base', async () => {
    await assert.rejects(pool.query('DELETE FROM transactions'), /ledger inmutable/);
    await assert.rejects(pool.query('UPDATE transactions SET monto_total_cobrado = 1'), /inmutables/);
    await assert.rejects(pool.query('UPDATE transaction_debts SET monto_aplicado = 1'), /inmutable/);
  });
});

describe('Portal B2B y aislamiento multi-tenant', () => {
  let tranquila;
  let limaNorte;

  before(async () => {
    tranquila = await loginAdmin('admin@tranquila.pe');
    limaNorte = await loginAdmin('admin@limanorte.pe');
  });

  test('cada administradora ve solo sus unidades', async () => {
    const { data } = await api('GET', '/tenant/units', { token: limaNorte });
    assert.deepEqual(data.map((u) => u.codigo_interno), ['DPTO-1201']);
    const ajena = await api('PATCH', `/tenant/units/${U.dpto402}`, { token: limaNorte, body: { alias: 'hack' } });
    assert.equal(ajena.status, 404);
  });

  test('un residente no puede usar el portal B2B', async () => {
    const res = await api('GET', '/tenant/units', { token: juan });
    assert.equal(res.status, 403);
  });

  test('emisión masiva por alícuota es idempotente y encola avisos', async () => {
    const body = {
      organization_unit_id: SEED.edificios.pinos,
      periodo: '2099-01',
      concepto_principal: 'Mantenimiento 2099-01',
      fecha_vencimiento: '2099-01-15',
      modo_calculo: 'ALICUOTA',
      tipos_unidad: ['DEPARTAMENTO'],
      items: [{ item: 'Gastos comunes', monto: 20000 }],
    };
    const primera = await api('POST', '/tenant/debts/generate', { token: tranquila, body });
    assert.equal(primera.status, 201, JSON.stringify(primera.data));
    assert.equal(primera.data.cuotas_creadas, 2);
    assert.ok(primera.data.avisos_encolados > 0);

    const { rows } = await pool.query(`SELECT monto_base FROM debts WHERE periodo = '2099-01' AND billing_unit_id = $1`, [U.dpto402]);
    assert.equal(rows[0].monto_base, '250.00');

    const segunda = await api('POST', '/tenant/debts/generate', { token: tranquila, body });
    assert.equal(segunda.data.cuotas_creadas, 0);
    assert.equal(segunda.data.cuotas_omitidas_por_existir, 2);
  });

  test('el dispatcher envía avisos con link de pago', async () => {
    const resultado = await procesarNotificaciones({ limite: 200 });
    assert.ok(resultado.enviadas > 0);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM pay_links');
    assert.ok(rows[0].n > 0);
  });

  test('importación .xlsx: valida errores por fila y aplica solo si todo es válido', async () => {
    const archivo = async (filas) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('padron');
      ws.addRow(['codigo_interno', 'tipo_unidad', 'piso', 'area_m2', 'alicuota', 'techada', 'rol', 'tipo_doc', 'num_doc', 'nombres', 'apellidos', 'email']);
      filas.forEach((f) => ws.addRow(f));
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const enviar = async (buffer, modo) => {
      const form = new FormData();
      form.append('archivo', new Blob([buffer]), 'padron.xlsx');
      return api('POST', `/tenant/units/bulk-import?organization_unit_id=${SEED.edificios.pinos}&modo=${modo}`, { token: tranquila, raw: form });
    };

    const invalido = await enviar(
      await archivo([
        ['DPTO-601', 'DEPARTAMENTO', 6, 90, 1.3, '', 'PROPIETARIO', 'DNI', '1234', 'Ana', 'Lopez', 'correo-malo'],
        ['BAU-01', 'BAULERA', '', '', '', '', '', '', '', '', '', ''],
      ]),
      'confirmar'
    );
    assert.equal(invalido.status, 422);
    assert.equal(invalido.data.aplicado, false);
    const campos = invalido.data.errores.map((e) => `${e.fila}:${e.campo}`);
    assert.ok(campos.includes('2:num_doc'));
    assert.ok(campos.includes('2:email'));
    assert.ok(campos.includes('3:tipo_unidad'));

    const valido = await enviar(
      await archivo([
        ['DPTO-601', 'DEPARTAMENTO', 6, 90, 1.3, '', 'PROPIETARIO', 'DNI', '46000001', 'Ana', 'López', 'ana@example.com'],
        ['COCH-S1-20', 'COCHERA', '', 12, 0.3, 'NO', 'PROPIETARIO', 'DNI', '46000001', 'Ana', 'López', 'ana@example.com'],
      ]),
      'confirmar'
    );
    assert.equal(valido.status, 200, JSON.stringify(valido.data));
    assert.equal(valido.data.aplicado, true);
    assert.equal(valido.data.resumen.unidades_nuevas, 2);

    const ana = await api('POST', '/auth/otp', { body: { tipo_doc: 'DNI', num_doc: '46000001' } });
    assert.equal(ana.status, 202);
  });

  test('KPIs del edificio con efectividad de cobranza', async () => {
    const { data } = await api('GET', `/tenant/dashboard/kpis?organization_unit_id=${SEED.edificios.pinos}`, { token: tranquila });
    const pen = data.kpis.find((k) => k.moneda === 'PEN');
    assert.ok(Number(pen.total_recaudado) > 0);
    assert.ok(pen.efectividad_cobranza_pct > 0);
  });
});
