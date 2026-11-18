// Funciones de inventario reutilizables por ventas y servicio técnico.
// Todas reciben un client de pg para ejecutarse dentro de la transacción externa.

// Descontar stock. Para repuestos/accesorios descuenta cantidad de inventario.
// Para iPhones cambia el estado de la unidad física a 'vendido'.
async function descontarStock(client, { variante_id, cantidad, identificador, motivo, usuario_id }) {
  const v = await client.query(
    `SELECT v.id, p.id AS producto_id, p.tipo
     FROM variantes_producto v
     JOIN productos p ON v.producto_id = p.id
     WHERE v.id = $1 AND v.activo = true AND p.activo = true`,
    [variante_id]
  );

  if (v.rows.length === 0) {
    throw new Error('Variante o producto no encontrado o desactivado.');
  }

  const { producto_id, tipo } = v.rows[0];

  if (tipo === 'iphone') {
    const unidad = await client.query(
      `SELECT id FROM unidades_fisicas
       WHERE variante_id = $1 AND identificador = $2 AND estado = 'disponible'
       FOR UPDATE`,
      [variante_id, identificador]
    );

    if (unidad.rows.length === 0) {
      throw new Error('Unidad no encontrada o no disponible.');
    }

    await client.query(
      `UPDATE unidades_fisicas SET estado = 'vendido', updated_at = NOW() WHERE id = $1`,
      [unidad.rows[0].id]
    );

    await client.query(
      `INSERT INTO movimientos_inventario
         (variante_id, producto_id, unidad_fisica_id, tipo, cantidad, motivo, usuario_id)
       VALUES ($1, $2, $3, 'salida', 1, $4, $5)`,
      [variante_id, producto_id, unidad.rows[0].id, motivo, usuario_id]
    );
  } else {
    const inv = await client.query(
      'SELECT cantidad FROM inventario WHERE variante_id = $1 FOR UPDATE',
      [variante_id]
    );

    if (inv.rows.length === 0 || inv.rows[0].cantidad < cantidad) {
      throw new Error('Stock insuficiente.');
    }

    await client.query(
      'UPDATE inventario SET cantidad = cantidad - $1, updated_at = NOW() WHERE variante_id = $2',
      [cantidad, variante_id]
    );

    await client.query(
      `INSERT INTO movimientos_inventario
         (variante_id, producto_id, tipo, cantidad, motivo, usuario_id)
       VALUES ($1, $2, 'salida', $3, $4, $5)`,
      [variante_id, producto_id, cantidad, motivo, usuario_id]
    );
  }
}

// Registrar consumo de repuesto en una orden de servicio técnico
async function consumirRepuesto(client, { variante_id, cantidad, motivo, usuario_id }) {
  return descontarStock(client, { variante_id, cantidad, motivo, usuario_id });
}

// Devolver una unidad al stock (anulación de venta o devolución)
async function devolverUnidad(client, { unidad_fisica_id, motivo, usuario_id }) {
  const unidad = await client.query(
    `SELECT id, variante_id, estado FROM unidades_fisicas WHERE id = $1 FOR UPDATE`,
    [unidad_fisica_id]
  );

  if (unidad.rows.length === 0) {
    throw new Error('Unidad no encontrada.');
  }

  if (unidad.rows[0].estado !== 'vendido') {
    throw new Error('Solo se pueden devolver unidades vendidas.');
  }

  const { variante_id } = unidad.rows[0];

  const v = await client.query(
    `SELECT p.id AS producto_id FROM variantes_producto v
     JOIN productos p ON v.producto_id = p.id WHERE v.id = $1`,
    [variante_id]
  );

  await client.query(
    `UPDATE unidades_fisicas SET estado = 'disponible', updated_at = NOW() WHERE id = $1`,
    [unidad_fisica_id]
  );

  await client.query(
    `INSERT INTO movimientos_inventario
       (variante_id, producto_id, unidad_fisica_id, tipo, cantidad, motivo, usuario_id)
     VALUES ($1, $2, $3, 'entrada', 1, $4, $5)`,
    [variante_id, v.rows[0].producto_id, unidad_fisica_id, motivo, usuario_id]
  );
}

module.exports = { descontarStock, consumirRepuesto, devolverUnidad };
