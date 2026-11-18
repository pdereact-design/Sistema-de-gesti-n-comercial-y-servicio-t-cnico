const pool = require('../config/db');
const { trimSafe } = require('../utils/validators');

// Consultar variante con datos del producto
const consultarVariante = async (client, varianteId) => {
  const r = await client.query(
    `SELECT v.id, v.activo, v.sku, v.stock_minimo,
            p.id AS producto_id, p.activo AS producto_activo, p.tipo, p.nombre AS producto
     FROM variantes_producto v
     JOIN productos p ON v.producto_id = p.id
     WHERE v.id = $1`,
    [varianteId]
  );
  return r.rows.length > 0 ? r.rows[0] : null;
};

// GET /api/inventario
const getInventario = async (req, res, next) => {
  try {
    const { tipo, buscar } = req.query;

    // Repuestos y accesorios: stock desde inventario
    let rParams = [];
    let rWhere = `WHERE p.tipo IN ('repuesto', 'accesorio') AND v.activo = true AND p.activo = true`;
    if (tipo && tipo !== 'iphone') {
      rParams.push(tipo);
      rWhere += ` AND p.tipo = $${rParams.length}`;
    }
    if (trimSafe(buscar)) {
      rParams.push(`%${buscar.trim()}%`);
      rWhere += ` AND (p.nombre ILIKE $${rParams.length} OR v.sku ILIKE $${rParams.length})`;
    }

    const repuestos = await pool.query(
      `SELECT v.id AS variante_id, v.sku, p.nombre AS producto, p.tipo,
              COALESCE(i.cantidad, 0) AS stock, v.stock_minimo, p.id AS producto_id
       FROM variantes_producto v
       JOIN productos p ON v.producto_id = p.id
       LEFT JOIN inventario i ON i.variante_id = v.id
       ${rWhere}
       ORDER BY p.nombre ASC`,
      rParams
    );

    // iPhones: stock desde unidades_fisicas
    let iParams = [];
    let iWhere = `WHERE p.tipo = 'iphone' AND v.activo = true AND p.activo = true`;
    if (tipo && tipo !== 'iphone') {
      iWhere += ` AND 1=0`;
    }
    if (trimSafe(buscar)) {
      iParams.push(`%${buscar.trim()}%`);
      iWhere += ` AND (p.nombre ILIKE $${iParams.length} OR v.sku ILIKE $${iParams.length})`;
    }

    const iphones = await pool.query(
      `SELECT v.id AS variante_id, v.sku, p.nombre AS producto, p.tipo,
              (SELECT COUNT(*) FROM unidades_fisicas uf
               WHERE uf.variante_id = v.id AND uf.estado = 'disponible') AS stock,
              v.stock_minimo, p.id AS producto_id
       FROM variantes_producto v
       JOIN productos p ON v.producto_id = p.id
       ${iWhere}
       ORDER BY p.nombre ASC`,
      iParams
    );

    const data = [...repuestos.rows, ...iphones.rows];
    res.json({ success: true, total: data.length, data });
  } catch (err) {
    next(err);
  }
};

// GET /api/inventario/alertas
const getAlertas = async (req, res, next) => {
  try {
    const repuestos = await pool.query(
      `SELECT v.id AS variante_id, v.sku, p.nombre AS producto, p.tipo,
              COALESCE(i.cantidad, 0) AS stock_actual,
              v.stock_minimo,
              (v.stock_minimo - COALESCE(i.cantidad, 0)) AS faltante
       FROM variantes_producto v
       JOIN productos p ON v.producto_id = p.id
       LEFT JOIN inventario i ON i.variante_id = v.id
       WHERE p.tipo IN ('repuesto', 'accesorio')
         AND v.activo = true AND p.activo = true
         AND COALESCE(i.cantidad, 0) <= v.stock_minimo
       ORDER BY faltante DESC`
    );

    const iphones = await pool.query(
      `SELECT v.id AS variante_id, v.sku, p.nombre AS producto, p.tipo,
              (SELECT COUNT(*) FROM unidades_fisicas uf
               WHERE uf.variante_id = v.id AND uf.estado = 'disponible') AS stock_actual,
              v.stock_minimo,
              (v.stock_minimo - (
                SELECT COUNT(*) FROM unidades_fisicas uf
                WHERE uf.variante_id = v.id AND uf.estado = 'disponible'
              )) AS faltante
       FROM variantes_producto v
       JOIN productos p ON v.producto_id = p.id
       WHERE p.tipo = 'iphone'
         AND v.activo = true AND p.activo = true
         AND (
           SELECT COUNT(*) FROM unidades_fisicas uf
           WHERE uf.variante_id = v.id AND uf.estado = 'disponible'
         ) <= v.stock_minimo
       ORDER BY faltante DESC`
    );

    const data = [...repuestos.rows, ...iphones.rows];
    res.json({ success: true, total: data.length, data });
  } catch (err) {
    next(err);
  }
};

// GET /api/inventario/movimientos
const getMovimientos = async (req, res, next) => {
  try {
    const { variante_id, tipo, limite } = req.query;
    const params = [];
    const condiciones = [];
    let idx = 1;

    if (variante_id) {
      params.push(parseInt(variante_id, 10));
      condiciones.push(`m.variante_id = $${idx}`);
      idx++;
    }

    if (tipo && ['entrada', 'salida', 'ajuste'].includes(tipo)) {
      params.push(tipo);
      condiciones.push(`m.tipo = $${idx}`);
      idx++;
    }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
    const limit = Math.min(parseInt(limite, 10) || 100, 500);

    const result = await pool.query(
      `SELECT m.id, m.variante_id, v.sku, m.producto_id, p.nombre AS producto,
              m.tipo, m.cantidad, m.motivo, m.unidad_fisica_id,
              u.nombre AS usuario_nombre, m.created_at
       FROM movimientos_inventario m
       LEFT JOIN variantes_producto v ON m.variante_id = v.id
       LEFT JOIN productos p ON m.producto_id = p.id
       LEFT JOIN usuarios u ON m.usuario_id = u.id
       ${where}
       ORDER BY m.created_at DESC
       LIMIT ${limit}`,
      params
    );

    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/inventario/unidades
const getUnidades = async (req, res, next) => {
  try {
    const { variante_id, estado, buscar } = req.query;
    const params = [];
    const condiciones = [];
    let idx = 1;

    if (variante_id) {
      params.push(parseInt(variante_id, 10));
      condiciones.push(`uf.variante_id = $${idx}`);
      idx++;
    }

    if (estado && ['disponible', 'vendido', 'en_servicio', 'dado_de_baja'].includes(estado)) {
      params.push(estado);
      condiciones.push(`uf.estado = $${idx}`);
      idx++;
    }

    if (trimSafe(buscar)) {
      params.push(`%${buscar.trim()}%`);
      condiciones.push(`uf.identificador ILIKE $${idx}`);
      idx++;
    }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT uf.id, uf.variante_id, v.sku, p.nombre AS producto,
              uf.tipo_identificador, uf.identificador, uf.estado,
              uf.precio_compra, uf.created_at, uf.updated_at
       FROM unidades_fisicas uf
       JOIN variantes_producto v ON uf.variante_id = v.id
       JOIN productos p ON v.producto_id = p.id
       ${where}
       ORDER BY uf.created_at DESC`,
      params
    );

    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/inventario/:varianteId
const getInventarioByVariante = async (req, res, next) => {
  try {
    const varianteId = parseInt(req.params.varianteId, 10);
    if (isNaN(varianteId)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const v = await pool.query(
      `SELECT v.id, v.sku, v.stock_minimo, p.id AS producto_id, p.nombre, p.tipo
       FROM variantes_producto v
       JOIN productos p ON v.producto_id = p.id
       WHERE v.id = $1`,
      [varianteId]
    );

    if (v.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Variante no encontrada.' });
    }

    const variante = v.rows[0];
    let stock;

    if (variante.tipo === 'iphone') {
      const r = await pool.query(
        `SELECT COUNT(*) AS disponibles FROM unidades_fisicas
         WHERE variante_id = $1 AND estado = 'disponible'`,
        [varianteId]
      );
      stock = parseInt(r.rows[0].disponibles, 10);
    } else {
      const r = await pool.query(
        'SELECT cantidad FROM inventario WHERE variante_id = $1',
        [varianteId]
      );
      stock = r.rows.length > 0 ? parseInt(r.rows[0].cantidad, 10) : 0;
    }

    res.json({
      success: true,
      data: {
        variante_id: varianteId,
        sku: variante.sku,
        producto: variante.nombre,
        tipo: variante.tipo,
        stock_actual: stock,
        stock_minimo: variante.stock_minimo,
        alerta: stock <= variante.stock_minimo,
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/inventario/entrada
const entrada = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { variante_id, cantidad, tipo_identificador, identificador, precio_compra, motivo } = req.body;

    if (!variante_id) {
      return res.status(400).json({ success: false, message: 'variante_id es obligatorio.' });
    }

    const variante = await consultarVariante(client, variante_id);
    if (!variante) {
      return res.status(404).json({ success: false, message: 'Variante no encontrada.' });
    }
    if (!variante.activo) {
      return res.status(400).json({ success: false, message: 'Variante desactivada.' });
    }
    if (!variante.producto_activo) {
      return res.status(400).json({ success: false, message: 'Producto desactivado.' });
    }

    await client.query('BEGIN');

    if (variante.tipo === 'iphone') {
      // iPhone: registrar una unidad física individual
      if (!tipo_identificador || !identificador) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'tipo_identificador e identificador son obligatorios para iPhones.',
        });
      }

      const existe = await client.query(
        'SELECT id FROM unidades_fisicas WHERE identificador = $1',
        [identificador.trim()]
      );
      if (existe.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Ya existe una unidad con ese identificador.',
        });
      }

      const unidad = await client.query(
        `INSERT INTO unidades_fisicas
           (variante_id, tipo_identificador, identificador, estado, precio_compra)
         VALUES ($1, $2, $3, 'disponible', $4)
         RETURNING id`,
        [variante_id, tipo_identificador, identificador.trim(), precio_compra || null]
      );

      await client.query(
        `INSERT INTO movimientos_inventario
           (variante_id, producto_id, unidad_fisica_id, tipo, cantidad, motivo, usuario_id)
         VALUES ($1, $2, $3, 'entrada', 1, $4, $5)`,
        [variante_id, variante.producto_id, unidad.rows[0].id, motivo || 'Entrada de iPhone', req.user.id]
      );

      await client.query('COMMIT');
      res.status(201).json({
        success: true,
        message: 'Unidad registrada correctamente.',
        data: { unidad_id: unidad.rows[0].id, identificador: identificador.trim() },
      });

    } else {
      // Repuesto o accesorio: entrada por cantidad
      const cant = Number(cantidad);
      if (!Number.isFinite(cant) || !Number.isInteger(cant) || cant <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'cantidad debe ser un entero mayor a cero.' });
      }

      const result = await client.query(
        `INSERT INTO inventario (variante_id, producto_id, cantidad)
         VALUES ($1, $2, $3)
         ON CONFLICT (variante_id) DO UPDATE
           SET cantidad = inventario.cantidad + EXCLUDED.cantidad,
               updated_at = NOW()
         RETURNING cantidad`,
        [variante_id, variante.producto_id, cant]
      );

      await client.query(
        `INSERT INTO movimientos_inventario
           (variante_id, producto_id, tipo, cantidad, motivo, usuario_id)
         VALUES ($1, $2, 'entrada', $3, $4, $5)`,
        [variante_id, variante.producto_id, cant, motivo || 'Entrada de stock', req.user.id]
      );

      await client.query('COMMIT');
      res.status(201).json({
        success: true,
        message: 'Entrada registrada correctamente.',
        data: { variante_id, stock_nuevo: result.rows[0].cantidad },
      });
    }
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Ya existe una unidad con ese identificador.' });
    }
    next(err);
  } finally {
    client.release();
  }
};

// POST /api/inventario/salida
const salida = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { variante_id, cantidad, identificador, motivo } = req.body;

    if (!variante_id) {
      return res.status(400).json({ success: false, message: 'variante_id es obligatorio.' });
    }

    const variante = await consultarVariante(client, variante_id);
    if (!variante) {
      return res.status(404).json({ success: false, message: 'Variante no encontrada.' });
    }
    if (!variante.activo) {
      return res.status(400).json({ success: false, message: 'Variante desactivada.' });
    }
    if (!variante.producto_activo) {
      return res.status(400).json({ success: false, message: 'Producto desactivado.' });
    }

    await client.query('BEGIN');

    if (variante.tipo === 'iphone') {
      if (!identificador) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'identificador es obligatorio para salida de iPhones.',
        });
      }

      const unidad = await client.query(
        `SELECT id FROM unidades_fisicas
         WHERE variante_id = $1 AND identificador = $2 AND estado = 'disponible'
         FOR UPDATE`,
        [variante_id, identificador.trim()]
      );

      if (unidad.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Unidad no encontrada o no disponible.' });
      }

      await client.query(
        `UPDATE unidades_fisicas SET estado = 'vendido', updated_at = NOW() WHERE id = $1`,
        [unidad.rows[0].id]
      );

      await client.query(
        `INSERT INTO movimientos_inventario
           (variante_id, producto_id, unidad_fisica_id, tipo, cantidad, motivo, usuario_id)
         VALUES ($1, $2, $3, 'salida', 1, $4, $5)`,
        [variante_id, variante.producto_id, unidad.rows[0].id, motivo || 'Salida de iPhone', req.user.id]
      );

      await client.query('COMMIT');
      res.json({
        success: true,
        message: 'Salida registrada correctamente.',
        data: { unidad_id: unidad.rows[0].id, identificador: identificador.trim() },
      });

    } else {
      const cant = Number(cantidad);
      if (!Number.isFinite(cant) || !Number.isInteger(cant) || cant <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'cantidad debe ser un entero mayor a cero.' });
      }

      const inv = await client.query(
        'SELECT cantidad FROM inventario WHERE variante_id = $1 FOR UPDATE',
        [variante_id]
      );

      if (inv.rows.length === 0 || inv.rows[0].cantidad < cant) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Stock insuficiente.' });
      }

      await client.query(
        'UPDATE inventario SET cantidad = cantidad - $1, updated_at = NOW() WHERE variante_id = $2',
        [cant, variante_id]
      );

      await client.query(
        `INSERT INTO movimientos_inventario
           (variante_id, producto_id, tipo, cantidad, motivo, usuario_id)
         VALUES ($1, $2, 'salida', $3, $4, $5)`,
        [variante_id, variante.producto_id, cant, motivo || 'Salida de stock', req.user.id]
      );

      await client.query('COMMIT');
      res.json({
        success: true,
        message: 'Salida registrada correctamente.',
        data: { variante_id, cantidad_salida: cant },
      });
    }
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

// POST /api/inventario/ajuste
const ajuste = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { variante_id, cantidad_real, motivo } = req.body;

    if (!variante_id) {
      return res.status(400).json({ success: false, message: 'variante_id es obligatorio.' });
    }

    // Validar cantidad_real: entero finito mayor o igual a cero
    const cantidadReal = Number(cantidad_real);
    if (!Number.isFinite(cantidadReal) || !Number.isInteger(cantidadReal) || cantidadReal < 0) {
      return res.status(400).json({
        success: false,
        message: 'cantidad_real debe ser un número entero mayor o igual a cero.',
      });
    }

    const variante = await consultarVariante(client, variante_id);
    if (!variante) {
      return res.status(404).json({ success: false, message: 'Variante no encontrada.' });
    }
    if (!variante.activo) {
      return res.status(400).json({ success: false, message: 'Variante desactivada.' });
    }
    if (!variante.producto_activo) {
      return res.status(400).json({ success: false, message: 'Producto desactivado.' });
    }
    if (variante.tipo === 'iphone') {
      return res.status(400).json({
        success: false,
        message: 'Los iPhones se ajustan agregando o retirando unidades individuales, no por cantidad directa.',
      });
    }

    await client.query('BEGIN');

    // Intentar bloquear la fila existente
    let stock_anterior;
    const existing = await client.query(
      'SELECT cantidad FROM inventario WHERE variante_id = $1 FOR UPDATE',
      [variante_id]
    );

    if (existing.rows.length > 0) {
      stock_anterior = parseInt(existing.rows[0].cantidad, 10);
    } else {
      stock_anterior = 0;
    }

    let diferencia = cantidadReal - stock_anterior;

    if (diferencia === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'No hay diferencia que ajustar.' });
    }

    // Crear o actualizar la fila de inventario
    const insertResult = await client.query(
      `INSERT INTO inventario (variante_id, producto_id, cantidad)
       VALUES ($1, $2, $3)
       ON CONFLICT (variante_id) DO NOTHING
       RETURNING id`,
      [variante_id, variante.producto_id, cantidadReal]
    );

    let diferencia_final = diferencia;

    if (insertResult.rows.length === 0) {
      // Conflicto simultáneo: otra operación creó la fila
      // Recalcular la diferencia con el valor actual
      const retry = await client.query(
        'SELECT cantidad FROM inventario WHERE variante_id = $1 FOR UPDATE',
        [variante_id]
      );
      stock_anterior = parseInt(retry.rows[0].cantidad, 10);
      diferencia_final = cantidadReal - stock_anterior;

      if (diferencia_final === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'No hay diferencia que ajustar.' });
      }

      await client.query(
        'UPDATE inventario SET cantidad = $1, updated_at = NOW() WHERE variante_id = $2',
        [cantidadReal, variante_id]
      );
    }

    await client.query(
      `INSERT INTO movimientos_inventario
         (variante_id, producto_id, tipo, cantidad, motivo, usuario_id)
       VALUES ($1, $2, 'ajuste', $3, $4, $5)`,
      [variante_id, variante.producto_id, diferencia_final, motivo || 'Ajuste de inventario', req.user.id]
    );

    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Ajuste registrado correctamente.',
      data: {
        stock_anterior,
        stock_nuevo: cantidadReal,
        diferencia: diferencia_final,
      },
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

// PATCH /api/inventario/unidades/:id/estado
const cambiarEstadoUnidad = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const unidadId = parseInt(req.params.id, 10);
    const { estado, motivo } = req.body;

    if (isNaN(unidadId)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    if (!['disponible', 'vendido', 'en_servicio', 'dado_de_baja'].includes(estado)) {
      return res.status(400).json({ success: false, message: 'Estado no válido.' });
    }

    // Restringir al técnico: solo puede cambiar a en_servicio
    if (req.user.rol === 'tecnico' && estado !== 'en_servicio') {
      return res.status(403).json({
        success: false,
        message: 'El técnico solo puede cambiar el estado a en_servicio.',
      });
    }

    await client.query('BEGIN');

    // SELECT FOR UPDATE dentro de la transacción
    const unidad = await client.query(
      `SELECT uf.id, uf.estado, uf.variante_id, v.producto_id
       FROM unidades_fisicas uf
       JOIN variantes_producto v ON uf.variante_id = v.id
       WHERE uf.id = $1
       FOR UPDATE`,
      [unidadId]
    );

    if (unidad.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Unidad no encontrada.' });
    }

    const estadoActual = unidad.rows[0].estado;
    const variante_id  = unidad.rows[0].variante_id;
    const producto_id  = unidad.rows[0].producto_id;

    if (estadoActual === estado) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'La unidad ya está en ese estado.' });
    }

    // Actualizar estado (el trigger valida la transición)
    await client.query(
      'UPDATE unidades_fisicas SET estado = $1, updated_at = NOW() WHERE id = $2',
      [estado, unidadId]
    );

    // Generar movimiento según la transición
    if (estadoActual === 'disponible' && estado !== 'disponible') {
      // disponible → vendido/en_servicio/dado_de_baja: salida
      await client.query(
        `INSERT INTO movimientos_inventario
           (variante_id, producto_id, unidad_fisica_id, tipo, cantidad, motivo, usuario_id)
         VALUES ($1, $2, $3, 'salida', 1, $4, $5)`,
        [variante_id, producto_id, unidadId, motivo || 'Cambio de estado', req.user.id]
      );
    } else if (estadoActual === 'en_servicio' && estado === 'disponible') {
      // en_servicio → disponible: entrada (regresa al stock)
      await client.query(
        `INSERT INTO movimientos_inventario
           (variante_id, producto_id, unidad_fisica_id, tipo, cantidad, motivo, usuario_id)
         VALUES ($1, $2, $3, 'entrada', 1, $4, $5)`,
        [variante_id, producto_id, unidadId, motivo || 'Regreso de servicio', req.user.id]
      );
    }
    // en_servicio → dado_de_baja: sin movimiento (ya salió del stock)

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Estado actualizado a ${estado}.`,
      data: { id: unidadId, estado_anterior: estadoActual, estado_nuevo: estado },
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

module.exports = {
  getInventario,
  getInventarioByVariante,
  getAlertas,
  getMovimientos,
  getUnidades,
  entrada,
  salida,
  ajuste,
  cambiarEstadoUnidad,
};
