const { consumirRepuesto } = require('./inventario.service');

// Genera número de orden único: ST-YYYYMMDD-XXXXXX
function generarNumeroOrden() {
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const sufijo = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ST-${fecha}-${sufijo}`;
}

// Transiciones de estado permitidas
const TRANSICIONES = {
  recibido:           ['diagnostico', 'cancelado'],
  diagnostico:        ['en_reparacion', 'esperando_repuesto', 'cancelado'],
  en_reparacion:      ['esperando_repuesto', 'listo'],
  esperando_repuesto: ['en_reparacion'],
  listo:              ['entregado'],
  entregado:          [],
  cancelado:          [],
};

function transicionValida(estadoActual, estadoNuevo) {
  return (TRANSICIONES[estadoActual] || []).includes(estadoNuevo);
}

// Agregar repuesto a una orden y descontar stock dentro de la transacción externa.
// El precio se lee de la variante en la DB (fuente de verdad).
async function agregarRepuestoOrden(client, { ordenId, varianteId, cantidad, usuarioId }) {
  // Leer precio_venta y producto_id desde la variante
  const v = await client.query(
    `SELECT v.id, v.precio_venta, v.activo,
            p.id AS producto_id, p.tipo, p.activo AS producto_activo
     FROM variantes_producto v
     JOIN productos p ON v.producto_id = p.id
     WHERE v.id = $1`,
    [varianteId]
  );

  if (v.rows.length === 0) throw new Error('Variante no encontrada.');
  if (!v.rows[0].activo || !v.rows[0].producto_activo) throw new Error('Variante o producto desactivado.');
  if (v.rows[0].tipo === 'iphone') throw new Error('No se pueden usar iPhones como repuesto en una orden.');

  const precio   = parseFloat(v.rows[0].precio_venta);
  const productoId = v.rows[0].producto_id;
  const subtotal = parseFloat((precio * cantidad).toFixed(2));

  // Descontar stock mediante consumirRepuesto (que a su vez llama descontarStock)
  await consumirRepuesto(client, {
    variante_id: varianteId,
    cantidad,
    motivo:      `Orden servicio #${ordenId}`,
    usuario_id:  usuarioId,
  });

  // Insertar en repuestos_orden
  const result = await client.query(
    `INSERT INTO repuestos_orden
       (orden_id, producto_id, variante_id, cantidad, precio_unitario, subtotal)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [ordenId, productoId, varianteId, cantidad, precio, subtotal]
  );

  return result.rows[0];
}

// Devolver al inventario los repuestos de una orden cancelada.
async function devolverRepuestosOrden(client, { ordenId, usuarioId }) {
  const repuestos = await client.query(
    'SELECT variante_id, cantidad FROM repuestos_orden WHERE orden_id = $1',
    [ordenId]
  );

  for (const r of repuestos.rows) {
    if (!r.variante_id) continue; // repuesto histórico sin variante, no se devuelve

    const v = await client.query(
      `SELECT p.id AS producto_id
       FROM variantes_producto vp
       JOIN productos p ON vp.producto_id = p.id
       WHERE vp.id = $1`,
      [r.variante_id]
    );
    if (!v.rows[0]) continue;

    // Bloquear la fila de inventario antes de sumar
    await client.query(
      'SELECT id FROM inventario WHERE variante_id = $1 FOR UPDATE',
      [r.variante_id]
    );

    await client.query(
      'UPDATE inventario SET cantidad = cantidad + $1, updated_at = NOW() WHERE variante_id = $2',
      [r.cantidad, r.variante_id]
    );

    await client.query(
      `INSERT INTO movimientos_inventario
         (variante_id, producto_id, tipo, cantidad, motivo, usuario_id)
       VALUES ($1, $2, 'entrada', $3, $4, $5)`,
      [r.variante_id, v.rows[0].producto_id, r.cantidad, `Cancelación orden #${ordenId}`, usuarioId]
    );
  }
}

// Registrar ingreso en caja al cobrar una orden de servicio.
// movimientos_caja no tiene FK a ordenes_servicio, se registra solo con el concepto.
async function registrarCobroEnCaja(client, { sesionId, monto, ordenId, metodoPago }) {
  await client.query(
    `INSERT INTO movimientos_caja (sesion_id, tipo, monto, concepto)
     VALUES ($1, 'ingreso', $2, $3)`,
    [sesionId, monto, `Orden servicio #${ordenId} - ${metodoPago}`]
  );
}

module.exports = {
  generarNumeroOrden,
  transicionValida,
  agregarRepuestoOrden,
  devolverRepuestosOrden,
  registrarCobroEnCaja,
};
