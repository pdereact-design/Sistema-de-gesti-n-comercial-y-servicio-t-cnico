const { descontarStock, devolverUnidad } = require('./inventario.service');

// Genera un número de factura único: MM-YYYYMMDD-XXXXXX
function generarNumeroFactura() {
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const sufijo = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `MM-${fecha}-${sufijo}`;
}

// Descontar stock de todos los items dentro de la transacción externa.
async function descontarStockVenta(client, items, usuarioId, ventaId) {
  for (const item of items) {
    await descontarStock(client, {
      variante_id:   item.variante_id,
      cantidad:      item.cantidad,
      identificador: item.identificador || null,
      motivo:        `Venta #${ventaId}`,
      usuario_id:    usuarioId,
    });
  }
}

// Devolver el stock de una venta anulada.
// iPhones: usa devolverUnidad (verifica estado 'vendido' antes de revertir).
// Repuestos/accesorios: bloquea la fila de inventario antes de sumar.
async function devolverStockVenta(client, detalles, usuarioId, ventaId) {
  for (const d of detalles) {
    if (d.unidad_fisica_id) {
      await devolverUnidad(client, {
        unidad_fisica_id: d.unidad_fisica_id,
        motivo:           `Anulación venta #${ventaId}`,
        usuario_id:       usuarioId,
      });
    } else {
      const v = await client.query(
        `SELECT p.id AS producto_id
         FROM variantes_producto v
         JOIN productos p ON v.producto_id = p.id
         WHERE v.id = $1`,
        [d.variante_id]
      );
      if (!v.rows[0]) throw new Error(`Variante ${d.variante_id} no encontrada al devolver stock.`);

      // FOR UPDATE evita que otra operación simultánea lea el stock desactualizado
      await client.query(
        'SELECT id FROM inventario WHERE variante_id = $1 FOR UPDATE',
        [d.variante_id]
      );

      await client.query(
        'UPDATE inventario SET cantidad = cantidad + $1, updated_at = NOW() WHERE variante_id = $2',
        [d.cantidad, d.variante_id]
      );

      await client.query(
        `INSERT INTO movimientos_inventario
           (variante_id, producto_id, tipo, cantidad, motivo, usuario_id)
         VALUES ($1, $2, 'entrada', $3, $4, $5)`,
        [d.variante_id, v.rows[0].producto_id, d.cantidad, `Anulación venta #${ventaId}`, usuarioId]
      );
    }
  }
}

// Registrar ingreso en caja por una venta. El monto es el importe en efectivo.
async function registrarMovimientoCaja(client, { sesionId, monto, ventaId, metodoPago }) {
  const concepto = `Venta #${ventaId} - ${metodoPago}`;
  await client.query(
    `INSERT INTO movimientos_caja (sesion_id, tipo, monto, concepto, referencia_venta_id)
     VALUES ($1, 'ingreso', $2, $3, $4)`,
    [sesionId, monto, concepto, ventaId]
  );
}

// Registrar egreso en caja al anular una venta.
// Solo revierte el importe que originalmente entró a caja (monto_efectivo).
async function revertirMovimientoCaja(client, { sesionId, monto, ventaId }) {
  await client.query(
    `INSERT INTO movimientos_caja (sesion_id, tipo, monto, concepto, referencia_venta_id)
     VALUES ($1, 'egreso', $2, $3, $4)`,
    [sesionId, monto, `Anulación venta #${ventaId}`, ventaId]
  );
}

module.exports = {
  generarNumeroFactura,
  descontarStockVenta,
  devolverStockVenta,
  registrarMovimientoCaja,
  revertirMovimientoCaja,
};
