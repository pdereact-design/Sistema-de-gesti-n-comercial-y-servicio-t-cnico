const pool = require('../config/db');
const { parsePrecioConDefault } = require('../utils/validators');
const {
  generarNumeroFactura,
  descontarStockVenta,
  devolverStockVenta,
  registrarMovimientoCaja,
  revertirMovimientoCaja,
} = require('../services/ventas.service');

const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia', 'mixto'];

// Validar campos del body antes de abrir la transacción.
// El precio real de cada item se lee de la DB dentro del bloque transaccional.
function validarBodyVenta(body) {
  const { items, metodo_pago } = body;

  if (!metodo_pago || !METODOS_PAGO.includes(metodo_pago)) {
    throw new Error(`metodo_pago debe ser: ${METODOS_PAGO.join(', ')}.`);
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Se requiere al menos un producto en items.');
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const prefix = `items[${i}]`;

    if (!item.variante_id) throw new Error(`${prefix}: variante_id es obligatorio.`);

    const cantidad = Number(item.cantidad);
    if (!Number.isFinite(cantidad) || !Number.isInteger(cantidad) || cantidad <= 0) {
      throw new Error(`${prefix}: cantidad debe ser un entero mayor a cero.`);
    }

    // Descuento por línea: opcional, se valida contra el precio real de la DB
    if (item.descuento !== undefined) {
      const desc = Number(item.descuento);
      if (!Number.isFinite(desc) || desc < 0) {
        throw new Error(`${prefix}: descuento debe ser un número no negativo.`);
      }
    }
  }

  // Para mixto, monto_efectivo es obligatorio
  if (metodo_pago === 'mixto') {
    const me = Number(body.monto_efectivo);
    if (!Number.isFinite(me) || me < 0) {
      throw new Error('Para metodo_pago mixto se requiere monto_efectivo >= 0.');
    }
  }
}

// POST /api/ventas
const crearVenta = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { cliente_id, items, metodo_pago, descuento_global, monto_efectivo, observaciones } = req.body;

    // Validaciones previas al BEGIN (no tocan la DB)
    try {
      validarBodyVenta(req.body);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    let descGlobal;
    try {
      descGlobal = parsePrecioConDefault(descuento_global, 'descuento_global', 0);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    // Pre-check de sesión de caja para responder rápido si no hay ninguna abierta.
    // La verificación definitiva con FOR UPDATE ocurre dentro de la transacción.
    const sesionPrecheck = await pool.query(
      `SELECT id FROM sesiones_caja WHERE usuario_id = $1 AND estado = 'abierta' LIMIT 1`,
      [req.user.id]
    );
    if (sesionPrecheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Debes tener una sesión de caja abierta para registrar una venta.',
      });
    }

    await client.query('BEGIN');

    // Bloquear la sesión de caja dentro de la transacción para garantizar
    // que permanezca abierta durante toda la operación.
    const sesionResult = await client.query(
      `SELECT id FROM sesiones_caja WHERE usuario_id = $1 AND estado = 'abierta' LIMIT 1 FOR UPDATE`,
      [req.user.id]
    );
    if (sesionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'La sesión de caja fue cerrada mientras se procesaba la venta.',
      });
    }
    const sesionId = sesionResult.rows[0].id;

    // Verificar cliente dentro de la transacción
    if (cliente_id) {
      const cli = await client.query(
        'SELECT id FROM clientes WHERE id = $1 AND activo = true',
        [cliente_id]
      );
      if (cli.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Cliente no encontrado o inactivo.' });
      }
    }

    // El precio_venta de la variante es la fuente de verdad; el cliente no puede manipularlo.
    const itemsEnriquecidos = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const prefix = `items[${i}]`;

      const v = await client.query(
        `SELECT v.id, v.sku, v.precio_venta, v.activo,
                p.id AS producto_id, p.tipo, p.activo AS producto_activo
         FROM variantes_producto v
         JOIN productos p ON v.producto_id = p.id
         WHERE v.id = $1`,
        [item.variante_id]
      );

      if (v.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: `${prefix}: variante no encontrada.` });
      }

      const variante = v.rows[0];

      if (!variante.activo || !variante.producto_activo) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: `${prefix}: variante o producto desactivado.` });
      }

      if (variante.tipo === 'iphone') {
        if (!item.identificador?.trim()) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: `${prefix}: se requiere identificador (IMEI) para vender un iPhone.` });
        }
        if (Number(item.cantidad) !== 1) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: `${prefix}: cantidad debe ser 1 para iPhones. Usa líneas separadas para cada unidad.` });
        }
      }

      const cantidad = Number(item.cantidad);
      const precioUnitario = parseFloat(variante.precio_venta); // precio real de la DB
      const descLinea = item.descuento !== undefined ? Number(item.descuento) : 0;

      if (descLinea > precioUnitario * cantidad) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: `${prefix}: el descuento supera el subtotal de la línea.` });
      }

      const subtotalLinea = parseFloat((precioUnitario * cantidad - descLinea).toFixed(2));

      itemsEnriquecidos.push({
        variante_id:    variante.id,
        producto_id:    variante.producto_id,
        tipo:           variante.tipo,
        cantidad,
        precio_unitario: precioUnitario,
        descuento:      descLinea,
        subtotal:       subtotalLinea,
        identificador:  item.identificador?.trim() || null,
      });
    }

    // Calcular totales en el servidor
    const subtotal = parseFloat(itemsEnriquecidos.reduce((acc, i) => acc + i.subtotal, 0).toFixed(2));

    if (descGlobal > subtotal) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'El descuento global supera el subtotal.' });
    }

    const total = parseFloat((subtotal - descGlobal).toFixed(2));

    // Determinar el importe en efectivo para el movimiento de caja
    let montoEfectivo;
    if (metodo_pago === 'efectivo') {
      montoEfectivo = total;
    } else if (metodo_pago === 'mixto') {
      montoEfectivo = parseFloat(Number(monto_efectivo).toFixed(2));
      if (montoEfectivo > total) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'monto_efectivo no puede superar el total.' });
      }
    } else {
      montoEfectivo = 0; // tarjeta o transferencia: nada entra a caja
    }

    // Generar número de factura único con reintentos ante colisión de aleatoriedad
    let numeroFactura;
    for (let intento = 0; intento < 5; intento++) {
      numeroFactura = generarNumeroFactura();
      const dup = await client.query('SELECT id FROM ventas WHERE numero_factura = $1', [numeroFactura]);
      if (dup.rows.length === 0) break;
    }

    // Insertar la venta antes de descontar el stock para disponer del ventaId real.
    // Si el descuento falla a continuación, el ROLLBACK revierte también este INSERT.
    const ventaResult = await client.query(
      `INSERT INTO ventas
         (numero_factura, cliente_id, usuario_id, subtotal, descuento, total,
          metodo_pago, monto_efectivo, estado, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completada', $9)
       RETURNING *`,
      [
        numeroFactura,
        cliente_id || null,
        req.user.id,
        subtotal,
        descGlobal,
        total,
        metodo_pago,
        montoEfectivo,
        observaciones?.trim() || null,
      ]
    );
    const ventaId = ventaResult.rows[0].id;

    // Descontar stock usando el ventaId real para trazabilidad en movimientos_inventario.
    // Si falla (stock insuficiente, unidad no disponible), el ROLLBACK revierte
    // también el INSERT de ventas y queda sin efecto toda la operación.
    try {
      await descontarStockVenta(client, itemsEnriquecidos, req.user.id, ventaId);
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: e.message });
    }

    // Insertar detalle y obtener unidad_fisica_id para iPhones
    for (const item of itemsEnriquecidos) {
      let unidadFisicaId = null;

      if (item.tipo === 'iphone' && item.identificador) {
        // La unidad ya fue marcada como vendida por descontarStock;
        // consultamos su id para vincularlo en detalle_ventas
        const uf = await client.query(
          `SELECT id FROM unidades_fisicas WHERE identificador = $1`,
          [item.identificador]
        );
        if (uf.rows.length > 0) unidadFisicaId = uf.rows[0].id;
      }

      await client.query(
        `INSERT INTO detalle_ventas
           (venta_id, producto_id, variante_id, unidad_fisica_id,
            cantidad, precio_unitario, descuento, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          ventaId,
          item.producto_id,
          item.variante_id,
          unidadFisicaId,
          item.cantidad,
          item.precio_unitario,
          item.descuento,
          item.subtotal,
        ]
      );
    }

    // Registrar movimiento de caja solo si hay importe en efectivo
    if (montoEfectivo > 0) {
      await registrarMovimientoCaja(client, { sesionId, monto: montoEfectivo, ventaId, metodoPago: metodo_pago });
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Venta registrada correctamente.',
      data: ventaResult.rows[0],
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

// GET /api/ventas
const getVentas = async (req, res, next) => {
  try {
    const { estado, cliente_id, fecha_desde, fecha_hasta, limite } = req.query;
    const params = [];
    const condiciones = [];
    let idx = 1;

    if (req.user.rol === 'ventas') {
      params.push(req.user.id);
      condiciones.push(`v.usuario_id = $${idx}`);
      idx++;
    }

    if (estado && ['completada', 'anulada', 'pendiente'].includes(estado)) {
      params.push(estado);
      condiciones.push(`v.estado = $${idx}`);
      idx++;
    }

    if (cliente_id) {
      params.push(parseInt(cliente_id, 10));
      condiciones.push(`v.cliente_id = $${idx}`);
      idx++;
    }

    if (fecha_desde) {
      params.push(fecha_desde);
      condiciones.push(`v.created_at >= $${idx}`);
      idx++;
    }

    if (fecha_hasta) {
      params.push(fecha_hasta);
      condiciones.push(`v.created_at <= $${idx}`);
      idx++;
    }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
    const limit = Math.min(parseInt(limite, 10) || 50, 200);

    const result = await pool.query(
      `SELECT v.id, v.numero_factura, v.subtotal, v.descuento, v.total,
              v.metodo_pago, v.monto_efectivo, v.estado, v.created_at,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              u.nombre AS vendedor
       FROM ventas v
       LEFT JOIN clientes c ON v.cliente_id = c.id
       LEFT JOIN usuarios u ON v.usuario_id = u.id
       ${where}
       ORDER BY v.created_at DESC
       LIMIT ${limit}`,
      params
    );

    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/ventas/:id
const getVentaById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const venta = await pool.query(
      `SELECT v.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              u.nombre AS vendedor
       FROM ventas v
       LEFT JOIN clientes c ON v.cliente_id = c.id
       LEFT JOIN usuarios u ON v.usuario_id = u.id
       WHERE v.id = $1`,
      [id]
    );

    if (venta.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Venta no encontrada.' });
    }

    if (req.user.rol === 'ventas' && venta.rows[0].usuario_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'No tienes acceso a esta venta.' });
    }

    const detalle = await pool.query(
      `SELECT d.id, d.variante_id, v2.sku, p.nombre AS producto,
              d.unidad_fisica_id, uf.identificador AS imei,
              d.cantidad, d.precio_unitario, d.descuento, d.subtotal
       FROM detalle_ventas d
       LEFT JOIN variantes_producto v2 ON d.variante_id = v2.id
       LEFT JOIN productos p ON d.producto_id = p.id
       LEFT JOIN unidades_fisicas uf ON d.unidad_fisica_id = uf.id
       WHERE d.venta_id = $1
       ORDER BY d.id`,
      [id]
    );

    res.json({ success: true, data: { ...venta.rows[0], detalle: detalle.rows } });
  } catch (err) {
    next(err);
  }
};

// POST /api/ventas/:id/anular
const anularVenta = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const { motivo } = req.body;
    if (!motivo?.trim()) {
      return res.status(400).json({ success: false, message: 'El motivo de anulación es obligatorio.' });
    }

    // FOR UPDATE bloquea la venta contra anulaciones simultáneas
    // FOR UPDATE bloquea la venta contra anulaciones simultáneas
    const venta = await client.query(
      'SELECT * FROM ventas WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (venta.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Venta no encontrada.' });
    }

    if (venta.rows[0].estado === 'anulada') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'La venta ya fue anulada.' });
    }

    // Cargar detalle con los IDs necesarios para devolver stock
    const detalle = await client.query(
      'SELECT variante_id, unidad_fisica_id, cantidad FROM detalle_ventas WHERE venta_id = $1',
      [id]
    );

    // devolverStockVenta verifica estado vendido antes de revertir iPhones,
    // lo que impide devolver stock dos veces aunque lleguen dos requests simultáneos
    try {
      await devolverStockVenta(client, detalle.rows, req.user.id, id);
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: e.message });
    }

    // Marcar como anulada
    await client.query(
      `UPDATE ventas
       SET estado = 'anulada',
           observaciones = COALESCE(observaciones || ' | ', '') || $1
       WHERE id = $2`,
      [`Anulada: ${motivo.trim()}`, id]
    );

    // Revertir solo el importe en efectivo que originalmente entró a caja.
    // Si no hay sesión abierta y se debe registrar un reembolso, se aborta
    // para mantener la atomicidad: inventario, anulación y caja son un solo bloque.
    const montoEfectivo = parseFloat(venta.rows[0].monto_efectivo || 0);
    if (montoEfectivo > 0) {
      // FOR UPDATE bloquea la sesión hasta el COMMIT, evitando que un
      // cierre simultáneo invalide el egreso de reembolso.
      const sesion = await client.query(
        `SELECT id FROM sesiones_caja WHERE usuario_id = $1 AND estado = 'abierta' LIMIT 1 FOR UPDATE`,
        [req.user.id]
      );
      if (sesion.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Esta venta tiene un reembolso en efectivo de $${montoEfectivo}. Debes tener una sesión de caja abierta para registrarlo.`,
        });
      }
      await revertirMovimientoCaja(client, {
        sesionId: sesion.rows[0].id,
        monto:    montoEfectivo,
        ventaId:  id,
      });
    }

    await client.query('COMMIT');

    res.json({ success: true, message: 'Venta anulada correctamente.' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

module.exports = { crearVenta, getVentas, getVentaById, anularVenta };
