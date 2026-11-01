import PDFDocument from 'pdfkit';
import { formatMoney } from '../../shared/money.js';

const COLOR_MARCA = '#0F766E';

function nuevoDocumento(res, nombreArchivo, titulo) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: titulo, Author: 'Tranky' } });
  doc.pipe(res);
  doc.fillColor(COLOR_MARCA).fontSize(22).text('Tranky', { continued: true }).fillColor('#555').fontSize(11).text('  tu edificio, en tranquilidad');
  doc.moveDown(0.5).fillColor('#000').fontSize(16).text(titulo);
  doc.moveDown(0.5).strokeColor('#DDD').moveTo(50, doc.y).lineTo(545, doc.y).stroke().moveDown();
  return doc;
}

function fila(doc, etiqueta, valor) {
  const y = doc.y;
  doc.fontSize(10).fillColor('#555').text(etiqueta, 50, y, { width: 180 });
  doc.fillColor('#000').text(valor ?? '—', 230, y, { width: 315 });
  doc.moveDown(0.3);
}

function tabla(doc, columnas, filas) {
  const anchos = columnas.map((c) => c.ancho);
  const dibujar = (valores, opciones = {}) => {
    const y = doc.y;
    let x = 50;
    valores.forEach((v, i) => {
      doc.fontSize(10).fillColor(opciones.color ?? '#000').text(v, x, y, { width: anchos[i], align: columnas[i].align ?? 'left' });
      x += anchos[i];
    });
    doc.moveDown(0.4);
  };
  dibujar(columnas.map((c) => c.titulo), { color: '#555' });
  filas.forEach((f) => dibujar(f));
}

/** Aviso de cobranza (RF-R-05). */
export function renderAvisoCobranza(res, { cuota, unidad }) {
  const doc = nuevoDocumento(res, `aviso-${cuota.periodo}-${unidad.codigo_interno}.pdf`, 'Aviso de cobranza');
  fila(doc, 'Administradora', unidad.edificio.administradora);
  fila(doc, 'Edificio', `${unidad.edificio.nombre}${unidad.edificio.direccion ? ` – ${unidad.edificio.direccion}` : ''}`);
  fila(doc, 'Unidad', `${unidad.tipo_etiqueta} ${unidad.codigo_interno}${unidad.descripcion ? ` (${unidad.descripcion})` : ''}`);
  fila(doc, 'Concepto', `${cuota.concepto} – ${cuota.tipo_cuota_etiqueta}`);
  fila(doc, 'Periodo', cuota.periodo);
  fila(doc, 'Fecha de emisión', cuota.fecha_emision);
  fila(doc, 'Fecha de vencimiento', cuota.fecha_vencimiento);
  fila(doc, 'Estado', cuota.estado_etiqueta);
  doc.moveDown();

  tabla(
    doc,
    [
      { titulo: 'Detalle', ancho: 345 },
      { titulo: 'Monto', ancho: 150, align: 'right' },
    ],
    [
      ...cuota.detalle_items.map((i) => [i.item, formatMoney(i.monto, cuota.moneda)]),
      ['Subtotal', formatMoney(cuota.monto_base, cuota.moneda)],
      ...(Number(cuota.monto_mora) > 0 ? [['Mora', formatMoney(cuota.monto_mora, cuota.moneda)]] : []),
      ...(Number(cuota.monto_descuento) > 0 ? [['Descuento', `-${formatMoney(cuota.monto_descuento, cuota.moneda)}`]] : []),
      ['Total a pagar', formatMoney(cuota.monto_total, cuota.moneda)],
    ]
  );
  doc.moveDown().fontSize(9).fillColor('#555').text('Paga en segundos desde Tranky con Yape, tarjeta o código CIP.');
  doc.end();
}

/** Comprobante de recaudación (RF-R-06): solo para pagos confirmados por webhook. */
export function renderComprobante(res, { tx, cuotas }) {
  const doc = nuevoDocumento(res, `comprobante-${tx.codigo_operacion}.pdf`, 'Comprobante de recaudación');
  fila(doc, 'Código de operación', tx.codigo_operacion);
  fila(doc, 'Fecha de pago', new Date(tx.fecha_pago).toLocaleString('es-PE', { timeZone: 'America/Lima' }));
  fila(doc, 'Pagador', `${tx.nombres} ${tx.apellidos} (${tx.tipo_doc} ${tx.num_doc})`);
  fila(doc, 'Administradora', `${tx.administradora} – RUC ${tx.ruc}`);
  fila(doc, 'Edificio', `${tx.edificio}${tx.direccion ? ` – ${tx.direccion}` : ''}`);
  fila(doc, 'Método de pago', { YAPE: 'Yape', CARD: 'Tarjeta', CIP: 'Código CIP / QR' }[tx.metodo_pago]);
  doc.moveDown();

  tabla(
    doc,
    [
      { titulo: 'Unidad', ancho: 100 },
      { titulo: 'Periodo', ancho: 70 },
      { titulo: 'Concepto', ancho: 205 },
      { titulo: 'Monto', ancho: 120, align: 'right' },
    ],
    cuotas.map((c) => [c.codigo_interno, c.periodo, c.concepto_principal, formatMoney(c.monto_aplicado, tx.moneda)])
  );
  doc.moveDown();
  fila(doc, 'Cuotas cubiertas', formatMoney(tx.monto_deuda_cubierta, tx.moneda));
  if (tx.comision_asumida_por === 'PAGADOR') {
    fila(doc, 'Comisión de servicio', formatMoney(tx.comision_recaudadora, tx.moneda));
    fila(doc, 'IGV de la comisión', formatMoney(tx.igv_comision, tx.moneda));
    if (Number(tx.comision_pasarela) > 0) fila(doc, 'Comisión de pasarela', formatMoney(tx.comision_pasarela, tx.moneda));
  }
  fila(doc, 'Total pagado', formatMoney(tx.monto_total_cobrado, tx.moneda));
  doc.moveDown().fontSize(9).fillColor('#555').text('Constancia de recaudación por cuenta de la junta de propietarios. No es un comprobante de pago SUNAT.');
  doc.end();
}
