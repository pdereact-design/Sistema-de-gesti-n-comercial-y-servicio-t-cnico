const pool = require('../config/db');
const { parsePrecioConDefault } = require('../utils/validators');
const {
  generarNumeroOrden,
  transicionValida,
  agregarRepuestoOrden,
  devolverRepuestosOrden,
  registrarCobroEnCaja,
} = require('../services/servicio.service');

const ESTADOS_VALIDOS   = ['recibido', 'diagnostico', 'en_reparacion', 'esperando_repuesto', 'listo', 'entregado', 'cancelado'];
const METODOS_PAGO      = ['efectivo', 'tarjeta', 'transferencia', 'mixto'];
// Estados que ya no admiten cambios ni repuestos adicionales
const ESTADOS_TERMINALES = ['entregado', 'cancelado'];

// Verificar acceso del usuario a una orden: admin ve todo, técnico solo las suyas.
// Normaliza IDs a number para evitar comparaciones string vs number.
function verificarAccesoOrden(orden, usuario) {
  if (usuario.rol === 'admin') return true;
  if (usuario.rol === 'tecnico') return parseInt(orden.tecnico_id, 10) === parseInt(usuario.id, 10);
  return false;
}

// POST /api/servicio
const crearOrden = async (req, res, next) => {
  try {
    const {
      cliente_id, modelo_iphone_id, imei, capacidad, color,
      condicion_entrada, problema_reportado, prioridad, fecha_estimada,
      tecnico_id, observaciones,
    } = req.body;

    if (!problema_reportado?.trim()) {
      return res.status(400).json({ success: false, message: 'problema_reportado es obligatorio.' });
    }

    // Verificar cliente si se especificó
    if (cliente_id) {
      const cli = await pool.query('SELECT id FROM clientes WHERE id = $1 AND activo = true', [cliente_id]);
      if (cli.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Cliente no encontrado o inactivo.' });
      }
    }

    // Verificar técnico si se asignó
    if (tecnico_id) {
      const tec = await pool.query(
        `SELECT id FROM usuarios WHERE id = $1 AND activo = true AND rol_id = (SELECT id FROM roles WHERE nombre = 'tecnico')`,
        [tecnico_id]
      );
      if (tec.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Técnico no encontrado o inactivo.' });
      }
    }

    // Generar número de orden único con reintentos
    let numeroOrden;
    for (let i = 0; i < 5; i++) {
      numeroOrden = generarNumeroOrden();
      const dup = await pool.query('SELECT id FROM ordenes_servicio WHERE numero_orden = $1', [numeroOrden]);
      if (dup.rows.length === 0) break;
    }

    const result = await pool.query(
      `INSERT INTO ordenes_servicio
         (numero_orden, cliente_id, recibido_por, tecnico_id, modelo_iphone_id,
          imei, capacidad, color, condicion_entrada, problema_reportado,
          prioridad, fecha_estimada, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        numeroOrden,
        cliente_id    || null,
        req.user.id,
        tecnico_id    || null,
        modelo_iphone_id || null,
        imei?.trim()  || null,
        capacidad?.trim() || null,
        color?.trim() || null,
        condicion_entrada?.trim() || null,
        problema_reportado.trim(),
        prioridad     || 'normal',
        fecha_estimada || null,
        observaciones?.trim() || null,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0], message: 'Orden registrada.' });
  } catch (err) {
    next(err);
  }
};

// GET /api/servicio?estado=&prioridad=&tecnico_id=&cliente_id=
const getOrdenes = async (req, res, next) => {
  try {
    const { estado, prioridad, tecnico_id, cliente_id, limite } = req.query;
    const params = [];
    const condiciones = [];
    let idx = 1;

    // Técnico solo ve sus órdenes
    if (req.user.rol === 'tecnico') {
      params.push(req.user.id);
      condiciones.push(`o.tecnico_id = $${idx}`);
      idx++;
    }

    if (estado && ESTADOS_VALIDOS.includes(estado)) {
      params.push(estado);
      condiciones.push(`o.estado = $${idx}`);
      idx++;
    }

    if (prioridad && ['baja', 'normal', 'alta', 'urgente'].includes(prioridad)) {
      params.push(prioridad);
      condiciones.push(`o.prioridad = $${idx}`);
      idx++;
    }

    if (tecnico_id && req.user.rol === 'admin') {
      params.push(parseInt(tecnico_id, 10));
      condiciones.push(`o.tecnico_id = $${idx}`);
      idx++;
    }

    if (cliente_id) {
      params.push(parseInt(cliente_id, 10));
      condiciones.push(`o.cliente_id = $${idx}`);
      idx++;
    }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
    const limit = Math.min(parseInt(limite, 10) || 50, 200);

    const result = await pool.query(
      `SELECT o.id, o.numero_orden, o.estado, o.prioridad,
              o.problema_reportado, o.total, o.cobrado,
              o.created_at, o.fecha_estimada,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              t.nombre AS tecnico, m.nombre AS modelo
       FROM ordenes_servicio o
       LEFT JOIN clientes c   ON o.cliente_id   = c.id
       LEFT JOIN usuarios t   ON o.tecnico_id   = t.id
       LEFT JOIN modelos_iphone m ON o.modelo_iphone_id = m.id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT ${limit}`,
      params
    );

    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/servicio/:id
const getOrdenById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });

    const orden = await pool.query(
      `SELECT o.*,
              c.nombre AS cliente_nombre, c.apellido AS cliente_apellido,
              t.nombre AS tecnico,
              r.nombre AS recibido_por_nombre,
              m.nombre AS modelo
       FROM ordenes_servicio o
       LEFT JOIN clientes c   ON o.cliente_id      = c.id
       LEFT JOIN usuarios t   ON o.tecnico_id       = t.id
       LEFT JOIN usuarios r   ON o.recibido_por     = r.id
       LEFT JOIN modelos_iphone m ON o.modelo_iphone_id = m.id
       WHERE o.id = $1`,
      [id]
    );

    if (orden.rows.length === 0) return res.status(404).json({ success: false, message: 'Orden no encontrada.' });

    if (req.user.rol === 'tecnico' && orden.rows[0].tecnico_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'No tienes acceso a esta orden.' });
    }

    const repuestos = await pool.query(
      `SELECT rp.id, rp.variante_id, v.sku, p.nombre AS producto,
              rp.cantidad, rp.precio_unitario, rp.subtotal
       FROM repuestos_orden rp
       LEFT JOIN variantes_producto v ON rp.variante_id = v.id
       LEFT JOIN productos p ON rp.producto_id = p.id
       WHERE rp.orden_id = $1
       ORDER BY rp.id`,
      [id]
    );

    res.json({ success: true, data: { ...orden.rows[0], repuestos: repuestos.rows } });
  } catch (err) {
    next(err);
  }
};

// PUT /api/servicio/:id/diagnostico — actualizar diagnóstico, trabajo y costos
const actualizarDiagnostico = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });

    const orden = await pool.query('SELECT tecnico_id, estado FROM ordenes_servicio WHERE id = $1', [id]);
    if (orden.rows.length === 0) return res.status(404).json({ success: false, message: 'Orden no encontrada.' });

    if (ESTADOS_TERMINALES.includes(orden.rows[0].estado)) {
      return res.status(400).json({ success: false, message: 'No se puede modificar una orden entregada o cancelada.' });
    }

    if (!verificarAccesoOrden(orden.rows[0], req.user)) {
      return res.status(403).json({ success: false, message: 'No tienes acceso a esta orden.' });
    }

    const { diagnostico, trabajo_realizado, costo_mano_obra, observaciones } = req.body;

    let costoMO;
    try {
      costoMO = parsePrecioConDefault(costo_mano_obra, 'costo_mano_obra', null);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    const result = await pool.query(
      `UPDATE ordenes_servicio
       SET diagnostico      = COALESCE($1, diagnostico),
           trabajo_realizado = COALESCE($2, trabajo_realizado),
           costo_mano_obra  = COALESCE($3, costo_mano_obra),
           total            = costo_repuestos + COALESCE($3, costo_mano_obra),
           observaciones    = COALESCE($4, observaciones),
           updated_at       = NOW()
       WHERE id = $5
       RETURNING id, estado, diagnostico, trabajo_realizado, costo_mano_obra, total`,
      [
        diagnostico?.trim()       || null,
        trabajo_realizado?.trim() || null,
        costoMO,
        observaciones?.trim()     || null,
        id,
      ]
    );

    res.json({ success: true, data: result.rows[0], message: 'Diagnóstico actualizado.' });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/servicio/:id/tecnico — asignar o reasignar técnico
const asignarTecnico = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });

    const { tecnico_id } = req.body;
    if (!tecnico_id) return res.status(400).json({ success: false, message: 'tecnico_id es obligatorio.' });

    const tec = await pool.query(
      `SELECT id FROM usuarios WHERE id = $1 AND activo = true
       AND rol_id = (SELECT id FROM roles WHERE nombre = 'tecnico')`,
      [tecnico_id]
    );
    if (tec.rows.length === 0) return res.status(404).json({ success: false, message: 'Técnico no encontrado o inactivo.' });

    const result = await pool.query(
      `UPDATE ordenes_servicio SET tecnico_id = $1, updated_at = NOW()
       WHERE id = $2 AND estado NOT IN ('entregado', 'cancelado')
       RETURNING id, numero_orden, tecnico_id, estado`,
      [tecnico_id, id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Orden no encontrada o en estado terminal.' });
    }

    res.json({ success: true, data: result.rows[0], message: 'Técnico asignado.' });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/servicio/:id/estado
const actualizarEstado = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });

    const { estado } = req.body;
    if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
      return res.status(400).json({ success: false, message: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}.` });
    }

    // Cancelar desde aquí no está permitido; usar el endpoint /cancelar
    if (estado === 'cancelado') {
      return res.status(400).json({
        success: false,
        message: 'Para cancelar una orden usa POST /api/servicio/:id/cancelar.',
      });
    }

    await client.query('BEGIN');

    // FOR UPDATE impide que dos requests simultáneos apliquen la misma transición
    const orden = await client.query(
      'SELECT estado, tecnico_id FROM ordenes_servicio WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (orden.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Orden no encontrada.' });
    }

    if (!verificarAccesoOrden(orden.rows[0], req.user)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'No tienes acceso a esta orden.' });
    }

    if (!transicionValida(orden.rows[0].estado, estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Transición no permitida: ${orden.rows[0].estado} → ${estado}.`,
      });
    }

    const result = await client.query(
      `UPDATE ordenes_servicio SET estado = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, numero_orden, estado`,
      [estado, id]
    );

    await client.query('COMMIT');

    res.json({ success: true, data: result.rows[0], message: `Estado actualizado a ${estado}.` });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

// POST /api/servicio/:id/repuestos — agregar repuesto y descontar stock
const agregarRepuesto = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });

    const { variante_id, cantidad } = req.body;
    if (!variante_id) return res.status(400).json({ success: false, message: 'variante_id es obligatorio.' });

    const cant = Number(cantidad);
    if (!Number.isFinite(cant) || !Number.isInteger(cant) || cant <= 0) {
      return res.status(400).json({ success: false, message: 'cantidad debe ser un entero mayor a cero.' });
    }

    await client.query('BEGIN');

    // Bloquear la orden con FOR UPDATE para evitar modificaciones simultáneas
    const ordenResult = await client.query(
      'SELECT estado, tecnico_id FROM ordenes_servicio WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (ordenResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Orden no encontrada.' });
    }

    const orden = ordenResult.rows[0];

    if (ESTADOS_TERMINALES.includes(orden.estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'No se pueden agregar repuestos a una orden entregada o cancelada.' });
    }

    const estadosPermitidos = ['diagnostico', 'en_reparacion', 'esperando_repuesto'];
    if (!estadosPermitidos.includes(orden.estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Solo se pueden agregar repuestos cuando la orden está en: ${estadosPermitidos.join(', ')}.` });
    }

    if (!verificarAccesoOrden(orden, req.user)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'No tienes acceso a esta orden.' });
    }

    let repuesto;
    try {
      repuesto = await agregarRepuestoOrden(client, {
        ordenId:   id,
        varianteId: variante_id,
        cantidad:  cant,
        usuarioId: req.user.id,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: e.message });
    }

    // Recalcular costo_repuestos y total en la orden
    await client.query(
      `UPDATE ordenes_servicio
       SET costo_repuestos = (SELECT COALESCE(SUM(subtotal), 0) FROM repuestos_orden WHERE orden_id = $1),
           total = costo_mano_obra + (SELECT COALESCE(SUM(subtotal), 0) FROM repuestos_orden WHERE orden_id = $1),
           updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');

    res.status(201).json({ success: true, data: repuesto, message: 'Repuesto agregado y stock descontado.' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

// POST /api/servicio/:id/cobrar — cobrar la orden al momento de la entrega
const cobrarOrden = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });

    const { metodo_pago, monto_efectivo } = req.body;

    if (!metodo_pago || !METODOS_PAGO.includes(metodo_pago)) {
      return res.status(400).json({ success: false, message: `metodo_pago debe ser: ${METODOS_PAGO.join(', ')}.` });
    }

    if (metodo_pago === 'mixto') {
      const me = Number(monto_efectivo);
      if (!Number.isFinite(me) || me < 0) {
        return res.status(400).json({ success: false, message: 'Para metodo_pago mixto se requiere monto_efectivo >= 0.' });
      }
    }

    await client.query('BEGIN');

    const orden = await client.query(
      'SELECT id, estado, cobrado, total, tecnico_id FROM ordenes_servicio WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (orden.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Orden no encontrada.' });
    }

    // No se requiere que el cobrador sea el técnico asignado

    // Extraer total de la orden antes de los cálculos de pago
    const total = parseFloat(orden.rows[0].total);

    // Primero comprobar si la orden ya fue cobrada
if (orden.rows[0].cobrado === true) {
  await client.query('ROLLBACK');
  return res.status(409).json({
    success: false,
    message: 'La orden ya fue cobrada.'
  });
}

// Después comprobar si está lista para cobrar
if (orden.rows[0].estado !== 'listo') {
  await client.query('ROLLBACK');
  return res.status(400).json({
    success: false,
    message: 'Solo se pueden cobrar órdenes en estado listo.'
  });
}


    // Determinar monto en efectivo para caja
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
      montoEfectivo = 0;
    }

    // Si hay efectivo, bloquear la sesión de caja con FOR UPDATE hasta el COMMIT
    if (montoEfectivo > 0) {
      const sesion = await client.query(
        `SELECT id FROM sesiones_caja WHERE usuario_id = $1 AND estado = 'abierta' LIMIT 1 FOR UPDATE`,
        [req.user.id]
      );
      if (sesion.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Debes tener una sesión de caja abierta para cobrar en efectivo.',
        });
      }

      await registrarCobroEnCaja(client, {
        sesionId:   sesion.rows[0].id,
        monto:      montoEfectivo,
        ordenId:    id,
        metodoPago: metodo_pago,
      });
    }

    // Marcar como cobrada y cambiar estado a entregada
    const result = await client.query(
      `UPDATE ordenes_servicio
       SET cobrado        = TRUE,
           metodo_pago    = $1,
           monto_efectivo = $2,
           estado         = 'entregado',
           updated_at     = NOW()
       WHERE id = $3
       RETURNING id, numero_orden, estado, cobrado, total, metodo_pago, monto_efectivo`,
      [metodo_pago, montoEfectivo, id]
    );

    await client.query('COMMIT');

    res.json({ success: true, data: result.rows[0], message: 'Orden cobrada y entregada.' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

// POST /api/servicio/:id/cancelar
const cancelarOrden = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });

    const { motivo } = req.body;
    if (!motivo?.trim()) return res.status(400).json({ success: false, message: 'El motivo de cancelación es obligatorio.' });

    await client.query('BEGIN');

    const orden = await client.query(
      'SELECT estado, cobrado FROM ordenes_servicio WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (orden.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Orden no encontrada.' });
    }

    if (orden.rows[0].estado === 'cancelado') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'La orden ya fue cancelada.' });
    }

    // Órdenes entregadas o cobradas no se cancelan; requieren un proceso de reembolso
    if (orden.rows[0].estado === 'entregado' || orden.rows[0].cobrado) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'No se puede cancelar una orden entregada o cobrada. Gestiona el reembolso por otro medio.',
      });
    }

    // Devolver repuestos al inventario
    try {
      await devolverRepuestosOrden(client, { ordenId: id, usuarioId: req.user.id });
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: e.message });
    }

    await client.query(
      `UPDATE ordenes_servicio
       SET estado       = 'cancelado',
           observaciones = COALESCE(observaciones || ' | ', '') || $1,
           updated_at   = NOW()
       WHERE id = $2`,
      [`Cancelada: ${motivo.trim()}`, id]
    );

    await client.query('COMMIT');

    res.json({ success: true, message: 'Orden cancelada y repuestos devueltos al inventario.' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

module.exports = {
  crearOrden,
  getOrdenes,
  getOrdenById,
  actualizarDiagnostico,
  asignarTecnico,
  actualizarEstado,
  agregarRepuesto,
  cobrarOrden,
  cancelarOrden,
};
