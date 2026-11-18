// Pruebas del módulo de ventas (casos 4, 5 y 6).

'use strict';

const { test, before, after, describe } = require('node:test');
const assert  = require('node:assert/strict');
const { crearEntorno, destruirDB } = require('../setup/db-test');
const { crearServidor, request, tokenPara } = require('../setup/server-test');

process.env.DB_NAME = 'monomanzana_test';

let pool, srv, base;
let tokenAdmin, tokenVentas;

before(async () => {
  pool = await crearEntorno();

  delete require.cache[require.resolve('../../src/config/db')];
  const app = require('../../src/app');
  srv  = await crearServidor(app);
  base = srv.baseUrl;

  const { rows } = await pool.query(`
    SELECT u.id, u.email, r.nombre AS rol
    FROM usuarios u JOIN roles r ON u.rol_id = r.id
    WHERE u.email IN ('admin@test.com', 'ventas@test.com')
  `);
  tokenAdmin  = tokenPara(rows.find(u => u.rol === 'admin'));
  tokenVentas = tokenPara(rows.find(u => u.rol === 'ventas'));

  // Sesión de caja necesaria para registrar ventas en efectivo
  await request(base, 'POST', '/api/caja/abrir', { monto_apertura: 500 }, tokenVentas);
});

after(async () => {
  if (srv) await srv.cerrar();
  if (pool) await destruirDB(pool);
});

const req = (method, ruta, body, token) => request(base, method, ruta, body, token);

describe('Ventas — registro y descuento de inventario', () => {
  test('Caso 4: venta de repuesto descuenta inventario una sola vez', async () => {
    const { rows: antesRows } = await pool.query(`
      SELECT cantidad FROM inventario
      WHERE variante_id = (SELECT id FROM variantes_producto WHERE sku = 'REP-TEST-001-VAR')
    `);
    const stockAntes = parseInt(antesRows[0].cantidad, 10);

    const { rows: vRows } = await pool.query(
      `SELECT id FROM variantes_producto WHERE sku = 'REP-TEST-001-VAR'`
    );
    const varianteId = vRows[0].id;

    const res = await req('POST', '/api/ventas', {
      metodo_pago: 'efectivo',
      items: [{ variante_id: varianteId, cantidad: 2 }],
    }, tokenVentas);

    assert.equal(res.status, 201, `Venta falló: ${JSON.stringify(res.body)}`);

    const { rows: despuesRows } = await pool.query(`
      SELECT cantidad FROM inventario WHERE variante_id = $1
    `, [varianteId]);
    assert.equal(parseInt(despuesRows[0].cantidad, 10), stockAntes - 2,
      `Stock esperado ${stockAntes - 2}, stock real ${despuesRows[0].cantidad}`);
  });

  test('Caso 5: movimiento de inventario registrado con ID real de la venta', async () => {
    const { rows: ventaRows } = await pool.query(
      `SELECT id FROM ventas ORDER BY created_at DESC LIMIT 1`
    );
    const ventaId = ventaRows[0].id;

    const { rows: movRows } = await pool.query(
      `SELECT motivo FROM movimientos_inventario WHERE motivo = $1`,
      [`Venta #${ventaId}`]
    );

    assert.equal(movRows.length >= 1, true,
      `No se encontró movimiento con motivo "Venta #${ventaId}"`);
  });

  test('Caso 6: anulación devuelve el stock correctamente', async () => {
    const { rows: vRows } = await pool.query(
      `SELECT id FROM variantes_producto WHERE sku = 'REP-TEST-001-VAR'`
    );
    const varianteId = vRows[0].id;

    const { rows: antesRows } = await pool.query(
      `SELECT cantidad FROM inventario WHERE variante_id = $1`, [varianteId]
    );
    const stockAntes = parseInt(antesRows[0].cantidad, 10);

    // Registrar venta con tarjeta (no necesita efectivo, evita problema de sesión)
    const resVenta = await req('POST', '/api/ventas', {
      metodo_pago: 'tarjeta',
      items: [{ variante_id: varianteId, cantidad: 1 }],
    }, tokenVentas);
    assert.equal(resVenta.status, 201, `Venta falló: ${JSON.stringify(resVenta.body)}`);
    const ventaId = resVenta.body.data.id;

    // Stock debe haber bajado en 1
    const { rows: medioRows } = await pool.query(
      `SELECT cantidad FROM inventario WHERE variante_id = $1`, [varianteId]
    );
    assert.equal(parseInt(medioRows[0].cantidad, 10), stockAntes - 1);

    // Anular — solo admin puede anular
    const resAnulacion = await req('POST', `/api/ventas/${ventaId}/anular`,
      { motivo: 'Devolución test' }, tokenAdmin
    );
    assert.equal(resAnulacion.status, 200, `Anulación falló: ${JSON.stringify(resAnulacion.body)}`);

    // Stock debe haber vuelto al valor original
    const { rows: despuesRows } = await pool.query(
      `SELECT cantidad FROM inventario WHERE variante_id = $1`, [varianteId]
    );
    assert.equal(parseInt(despuesRows[0].cantidad, 10), stockAntes,
      `Stock no restaurado: esperado ${stockAntes}, actual ${despuesRows[0].cantidad}`);
  });
});
