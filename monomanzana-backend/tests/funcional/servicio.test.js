// Pruebas del módulo de servicio técnico (casos 7, 8, 9 y 10).

'use strict';

const { test, before, after, describe } = require('node:test');
const assert  = require('node:assert/strict');
const { crearEntorno, destruirDB } = require('../setup/db-test');
const { crearServidor, request, tokenPara } = require('../setup/server-test');

process.env.DB_NAME = 'monomanzana_test';

let pool, srv, base;
let tokenAdmin, tokenVentas, tokenTecnico;

before(async () => {
  pool = await crearEntorno();

  delete require.cache[require.resolve('../../src/config/db')];
  const app = require('../../src/app');
  srv  = await crearServidor(app);
  base = srv.baseUrl;

  const { rows } = await pool.query(`
    SELECT u.id, u.email, r.nombre AS rol
    FROM usuarios u JOIN roles r ON u.rol_id = r.id
    WHERE u.email IN ('admin@test.com', 'ventas@test.com', 'tecnico@test.com')
  `);
  tokenAdmin   = tokenPara(rows.find(u => u.rol === 'admin'));
  tokenVentas  = tokenPara(rows.find(u => u.rol === 'ventas'));
  tokenTecnico = tokenPara(rows.find(u => u.rol === 'tecnico'));
});

after(async () => {
  if (srv) await srv.cerrar();
  if (pool) await destruirDB(pool);
});

const req = (method, ruta, body, token) => request(base, method, ruta, body, token);

// Helper: crear orden y avanzarla hasta un estado dado
async function crearOrdenEnEstado(estadoFinal) {
  const { rows: tRows } = await pool.query(
    `SELECT id FROM usuarios WHERE email = 'tecnico@test.com'`
  );
  const tecnicoId = tRows[0].id;

  const resOrden = await req('POST', '/api/servicio', {
    problema_reportado: `Prueba estado ${estadoFinal}`,
    tecnico_id: tecnicoId,
  }, tokenAdmin);
  assert.equal(resOrden.status, 201, `No se pudo crear orden: ${JSON.stringify(resOrden.body)}`);

  const id = resOrden.body.data.id;
  const flujo = { diagnostico: ['diagnostico'], en_reparacion: ['diagnostico','en_reparacion'], listo: ['diagnostico','en_reparacion','listo'] };
  for (const e of (flujo[estadoFinal] || [])) {
    const r = await req('PATCH', `/api/servicio/${id}/estado`, { estado: e }, tokenTecnico);
    assert.equal(r.status, 200, `Estado ${e} falló: ${JSON.stringify(r.body)}`);
  }
  return id;
}

// Helper: asegurar sesión de caja abierta para ventas
async function asegurarSesionCaja() {
  const { rows } = await pool.query(
    `SELECT id FROM sesiones_caja WHERE usuario_id = (SELECT id FROM usuarios WHERE email = 'ventas@test.com') AND estado = 'abierta'`
  );
  if (rows.length === 0) {
    const r = await req('POST', '/api/caja/abrir', { monto_apertura: 500 }, tokenVentas);
    assert.equal(r.status, 201, `No se pudo abrir caja: ${JSON.stringify(r.body)}`);
  }
}

describe('Servicio técnico — cobro', () => {
  let ordenId;

  before(async () => {
    ordenId = await crearOrdenEnEstado('listo');
    await asegurarSesionCaja();
  });

  test('Caso 7: cobrar orden en estado listo', async () => {
    const res = await req('POST', `/api/servicio/${ordenId}/cobrar`,
      { metodo_pago: 'efectivo' }, tokenVentas);
    assert.equal(res.status, 200, `Cobro falló: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.data.cobrado, true);
    assert.equal(res.body.data.estado, 'entregado');
  });

  test('Caso 8: intentar cobrar la misma orden dos veces devuelve 409', async () => {
    const res = await req('POST', `/api/servicio/${ordenId}/cobrar`,
      { metodo_pago: 'efectivo' }, tokenVentas);
    assert.equal(res.status, 409, `Esperado 409, recibido ${res.status}: ${JSON.stringify(res.body)}`);
  });
});

describe('Servicio técnico — repuesto y cancelación concurrente', () => {
  let ordenId;

  before(async () => {
    ordenId = await crearOrdenEnEstado('diagnostico');
  });

  test('Caso 9: repuesto y cancelación simultáneos — el inventario debe quedar consistente', async () => {
    const { rows: vRows } = await pool.query(
      `SELECT id FROM variantes_producto WHERE sku = 'REP-TEST-001-VAR'`
    );
    const varianteId = vRows[0].id;

    const { rows: invAntes } = await pool.query(
      `SELECT cantidad FROM inventario WHERE variante_id = $1`, [varianteId]
    );
    const stockAntes = parseInt(invAntes[0].cantidad, 10);

    const [rRep, rCan] = await Promise.all([
      req('POST', `/api/servicio/${ordenId}/repuestos`, { variante_id: varianteId, cantidad: 1 }, tokenTecnico),
      req('POST', `/api/servicio/${ordenId}/cancelar`, { motivo: 'Test concurrencia' }, tokenAdmin),
    ]);

    // Ambas pueden completarse si PostgreSQL las serializa (FOR UPDATE garantiza orden).
    // Lo que NO puede ocurrir: repuesto descontado y orden sin cancelar con stock incorrecto.
    const { rows: invDespues } = await pool.query(
      `SELECT cantidad FROM inventario WHERE variante_id = $1`, [varianteId]
    );
    const stockDespues = parseInt(invDespues[0].cantidad, 10);

    const { rows: ordenRows } = await pool.query(
      `SELECT estado FROM ordenes_servicio WHERE id = $1`, [ordenId]
    );
    const estadoFinal = ordenRows[0].estado;

    // Variante A: cancelación ganó primero → repuesto rechazado → stock igual al inicial
    // Variante B: repuesto ganó primero → cancelación canceló y devolvió el repuesto → stock igual al inicial
    // Variante C: repuesto ganó, cancelación falló → stock bajó en 1 y orden sigue activa
    // En A y B el stock debe ser stockAntes. En C debe ser stockAntes - 1.
    if (estadoFinal === 'cancelado') {
      assert.equal(stockDespues, stockAntes,
        `Orden cancelada: stock debe ser ${stockAntes}, es ${stockDespues}`);
    } else {
      // Orden no cancelada: el repuesto se agregó y no se devolvió
      assert.equal(stockDespues, stockAntes - 1,
        `Repuesto sin cancelar: stock debe ser ${stockAntes - 1}, es ${stockDespues}`);
      // Verificar que hay exactamente un repuesto registrado en la orden
      const { rows: repRows } = await pool.query(
        `SELECT COUNT(*) AS total FROM repuestos_orden WHERE orden_id = $1`, [ordenId]
      );
      assert.equal(parseInt(repRows[0].total, 10), 1, 'Debe haber exactamente un repuesto en la orden');
    }

    // En ningún caso debe haber stock negativo
    assert.ok(stockDespues >= 0, `Stock no puede ser negativo: ${stockDespues}`);
  });
});

describe('Servicio técnico — cobro durante cierre de caja', () => {
  let ordenId;

  before(async () => {
    ordenId = await crearOrdenEnEstado('listo');
    await asegurarSesionCaja();
  });

  test('Caso 10: cobro vs cierre de caja — resultado coherente', async () => {
    const [rCobro, rCierre] = await Promise.all([
      req('POST', `/api/servicio/${ordenId}/cobrar`, { metodo_pago: 'efectivo' }, tokenVentas),
      req('POST', '/api/caja/cerrar', { monto_cierre: 500 }, tokenVentas),
    ]);

    // Al menos una debe completarse
    const algExito = [rCobro.status, rCierre.status].some(s => s === 200);
    assert.ok(algExito,
      `Al menos una debe completarse. Cobro: ${rCobro.status}, Cierre: ${rCierre.status}`);

    // Si la orden quedó cobrada con efectivo, debe existir el movimiento de caja
    const { rows: oRows } = await pool.query(
      `SELECT cobrado, monto_efectivo FROM ordenes_servicio WHERE id = $1`, [ordenId]
    );
    if (oRows[0].cobrado && parseFloat(oRows[0].monto_efectivo) > 0) {
      const { rows: mRows } = await pool.query(
        `SELECT COUNT(*) AS total FROM movimientos_caja WHERE concepto LIKE $1 AND tipo = 'ingreso'`,
        [`%Orden servicio #${ordenId}%`]
      );
      assert.equal(parseInt(mRows[0].total, 10), 1,
        'Orden cobrada en efectivo debe tener exactamente un movimiento de ingreso en caja');
    }
  });
});
