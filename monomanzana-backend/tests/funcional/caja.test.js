// Pruebas del módulo de caja (casos 1, 2 y 3).

'use strict';

const { test, before, after, describe } = require('node:test');
const assert  = require('node:assert/strict');
const { crearEntorno, destruirDB } = require('../setup/db-test');
const { crearServidor, request, tokenPara } = require('../setup/server-test');

// Configurar DB de pruebas antes de cargar la app
process.env.DB_NAME = 'monomanzana_test';

let pool, srv, base;
let tokenAdmin, tokenVentas;

before(async () => {
  pool = await crearEntorno();

  // Cargar app después de fijar DB_NAME a la base de pruebas
  delete require.cache[require.resolve('../../src/config/db')];
  const app = require('../../src/app');
  srv = await crearServidor(app);
  base = srv.baseUrl;

  const { rows } = await pool.query(`
    SELECT u.id, u.email, r.nombre AS rol
    FROM usuarios u JOIN roles r ON u.rol_id = r.id
    WHERE u.email IN ('admin@test.com', 'ventas@test.com')
  `);
  tokenAdmin  = tokenPara(rows.find(u => u.rol === 'admin'));
  tokenVentas = tokenPara(rows.find(u => u.rol === 'ventas'));
});

after(async () => {
  if (srv) await srv.cerrar();
  if (pool) await destruirDB(pool);
});

const req = (method, ruta, body, token) => request(base, method, ruta, body, token);

describe('Caja — apertura', () => {
  test('Caso 1a: apertura normal de sesión', async () => {
    const res = await req('POST', '/api/caja/abrir', { monto_apertura: 100 }, tokenVentas);
    assert.equal(res.status, 201, `Esperado 201: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.success, true);
  });

  test('Caso 1b: dos aperturas simultáneas — solo una debe completarse', async () => {
    // Cerrar la sesión del test anterior
    await req('POST', '/api/caja/cerrar', { monto_cierre: 100 }, tokenVentas);

    const [r1, r2] = await Promise.all([
      req('POST', '/api/caja/abrir', { monto_apertura: 50 }, tokenVentas),
      req('POST', '/api/caja/abrir', { monto_apertura: 50 }, tokenVentas),
    ]);

    const estados = [r1.status, r2.status].sort();
    assert.deepEqual(estados, [201, 409],
      `Esperado [201, 409], recibido ${JSON.stringify(estados)}`);

    const { rows } = await pool.query(`
      SELECT COUNT(*) AS total FROM sesiones_caja
      WHERE usuario_id = (SELECT id FROM usuarios WHERE email = 'ventas@test.com')
      AND estado = 'abierta'
    `);
    assert.equal(parseInt(rows[0].total, 10), 1, 'Debe existir exactamente una sesión abierta');
  });
});

describe('Caja — cierre', () => {
  test('Caso 2a: cierre normal de sesión', async () => {
    const res = await req('POST', '/api/caja/cerrar', { monto_cierre: 50 }, tokenVentas);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.estado, 'cerrada');
  });

  test('Caso 2b: dos cierres simultáneos — solo uno debe completarse', async () => {
    await req('POST', '/api/caja/abrir', { monto_apertura: 80 }, tokenVentas);

    const [r1, r2] = await Promise.all([
      req('POST', '/api/caja/cerrar', { monto_cierre: 80 }, tokenVentas),
      req('POST', '/api/caja/cerrar', { monto_cierre: 80 }, tokenVentas),
    ]);

    const exitosos = [r1.status, r2.status].filter(s => s === 200).length;
    assert.equal(exitosos, 1,
      `Exactamente un cierre debe completarse. Recibido: ${[r1.status, r2.status]}`);
  });
});

describe('Caja — movimiento durante cierre', () => {
  test('Caso 3: movimiento y cierre simultáneos — estado final coherente', async () => {
    await req('POST', '/api/caja/abrir', { monto_apertura: 100 }, tokenVentas);

    // Lanzar movimiento y cierre simultáneamente
    const [rMov, rCierre] = await Promise.all([
      req('POST', '/api/caja/movimiento', { tipo: 'ingreso', monto: 10, concepto: 'Prueba concurrencia' }, tokenVentas),
      req('POST', '/api/caja/cerrar',     { monto_cierre: 110 }, tokenVentas),
    ]);

    // La sesión debe terminar cerrada en cualquier caso
    const { rows: sesiones } = await pool.query(`
      SELECT estado, monto_cierre, monto_esperado, cierre_at
      FROM sesiones_caja
      WHERE usuario_id = (SELECT id FROM usuarios WHERE email = 'ventas@test.com')
      ORDER BY apertura_at DESC LIMIT 1
    `);
    assert.equal(sesiones[0].estado, 'cerrada', 'La sesión debe terminar cerrada');

    const cierreAt = new Date(sesiones[0].cierre_at);

    // Buscar el movimiento de esta prueba
    const { rows: movs } = await pool.query(`
      SELECT mc.id, mc.created_at, sc.estado
      FROM movimientos_caja mc
      JOIN sesiones_caja sc ON mc.sesion_id = sc.id
      WHERE sc.usuario_id = (SELECT id FROM usuarios WHERE email = 'ventas@test.com')
        AND mc.concepto = 'Prueba concurrencia'
    `);

    if (rMov.status === 201) {
      // El movimiento ganó el bloqueo: debe existir y haberse registrado ANTES del cierre
      assert.equal(movs.length, 1, 'El movimiento debe estar registrado exactamente una vez');
      const movAt = new Date(movs[0].created_at);
      assert.ok(movAt <= cierreAt,
        `El movimiento debe haberse registrado antes o durante el cierre. mov: ${movAt.toISOString()}, cierre: ${cierreAt.toISOString()}`);
    } else {
      // El cierre ganó el bloqueo: el movimiento fue rechazado (sesión cerrada cuando llegó)
      assert.equal(movs.length, 0, 'Si el movimiento fue rechazado, no debe existir registro');
    }

    // En ningún caso debe haber movimientos con created_at posterior al cierre
    const { rows: posteriores } = await pool.query(`
      SELECT mc.id FROM movimientos_caja mc
      JOIN sesiones_caja sc ON mc.sesion_id = sc.id
      WHERE sc.usuario_id = (SELECT id FROM usuarios WHERE email = 'ventas@test.com')
        AND mc.concepto = 'Prueba concurrencia'
        AND mc.created_at > sc.cierre_at
    `);
    assert.equal(posteriores.length, 0,
      'No debe haber movimientos registrados después del cierre de sesión');
  });
});
