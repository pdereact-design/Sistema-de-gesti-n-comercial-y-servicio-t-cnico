const pool = require('../config/db');
const { parsePrecioConDefault } = require('../utils/validators');

// Consultar la sesión abierta de un usuario
const sesionAbierta = async (usuarioId) => {
  const r = await pool.query(
    `SELECT * FROM sesiones_caja WHERE usuario_id = $1 AND estado = 'abierta' LIMIT 1`,
    [usuarioId]
  );
  return r.rows.length > 0 ? r.rows[0] : null;
};

// Calcular el monto esperado sumando apertura + ingresos - egresos
const calcularMontoEsperado = async (client, sesionId, montoApertura) => {
  const r = await client.query(
    `SELECT
       COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE 0 END), 0) AS total_ingresos,
       COALESCE(SUM(CASE WHEN tipo = 'egreso'  THEN monto ELSE 0 END), 0) AS total_egresos
     FROM movimientos_caja WHERE sesion_id = $1`,
    [sesionId]
  );
  const { total_ingresos, total_egresos } = r.rows[0];
  return parseFloat(montoApertura) + parseFloat(total_ingresos) - parseFloat(total_egresos);
};

// POST /api/caja/abrir
const abrirSesion = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { monto_apertura, observaciones } = req.body;

    let monto;
    try {
      monto = parsePrecioConDefault(monto_apertura, 'monto_apertura', 0);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    await client.query('BEGIN');

    // Lock advisory por usuario para serializar aperturas simultáneas.
    // Espacio de nombres 1 reservado para caja. Se libera al COMMIT o ROLLBACK.
    await client.query('SELECT pg_advisory_xact_lock(1, $1)', [req.user.id]);

    // Con el lock tomado, verificar si ya existe una sesión abierta
    const activa = await client.query(
      `SELECT id FROM sesiones_caja WHERE usuario_id = $1 AND estado = 'abierta' LIMIT 1`,
      [req.user.id]
    );

    if (activa.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Ya tienes una sesión de caja abierta.',
        sesion_id: activa.rows[0].id,
      });
    }

    const result = await client.query(
      `INSERT INTO sesiones_caja (usuario_id, monto_apertura, estado, observaciones)
       VALUES ($1, $2, 'abierta', $3)
       RETURNING *`,
      [req.user.id, monto, observaciones?.trim() || null]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Sesión de caja abierta.',
      data: result.rows[0],
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

// GET /api/caja/sesion-activa
const getSesionActiva = async (req, res, next) => {
  try {
    const sesion = await sesionAbierta(req.user.id);

    if (!sesion) {
      return res.status(404).json({ success: false, message: 'No tienes una sesión de caja abierta.' });
    }

    // Incluir el monto esperado calculado en tiempo real
    const client = await pool.connect();
    let montoEsperado;
    try {
      montoEsperado = await calcularMontoEsperado(client, sesion.id, sesion.monto_apertura);
    } finally {
      client.release();
    }

    res.json({
      success: true,
      data: { ...sesion, monto_esperado_actual: montoEsperado },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/caja/sesiones — historial de sesiones del usuario (admin ve todas)
const getSesiones = async (req, res, next) => {
  try {
    const { estado, limite } = req.query;
    const params = [];
    const condiciones = [];
    let idx = 1;

    // Admin ve todas las sesiones; otros usuarios solo las propias
    if (req.user.rol !== 'admin') {
      params.push(req.user.id);
      condiciones.push(`s.usuario_id = $${idx}`);
      idx++;
    }

    if (estado && ['abierta', 'cerrada'].includes(estado)) {
      params.push(estado);
      condiciones.push(`s.estado = $${idx}`);
      idx++;
    }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
    const limit = Math.min(parseInt(limite, 10) || 50, 200);

    const result = await pool.query(
      `SELECT s.id, s.usuario_id, u.nombre AS usuario, s.monto_apertura,
              s.monto_cierre, s.monto_esperado, s.diferencia,
              s.estado, s.observaciones, s.apertura_at, s.cierre_at
       FROM sesiones_caja s
       JOIN usuarios u ON s.usuario_id = u.id
       ${where}
       ORDER BY s.apertura_at DESC
       LIMIT ${limit}`,
      params
    );

    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/caja/sesiones/:id — detalle de una sesión con sus movimientos
const getSesionById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const sesionResult = await pool.query(
      `SELECT s.*, u.nombre AS usuario
       FROM sesiones_caja s
       JOIN usuarios u ON s.usuario_id = u.id
       WHERE s.id = $1`,
      [id]
    );

    if (sesionResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Sesión no encontrada.' });
    }

    const sesion = sesionResult.rows[0];

    // Verificar acceso: solo el dueño o admin
    if (req.user.rol !== 'admin' && sesion.usuario_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'No tienes acceso a esta sesión.' });
    }

    const movimientos = await pool.query(
      `SELECT id, tipo, monto, concepto, referencia_venta_id, created_at
       FROM movimientos_caja
       WHERE sesion_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    res.json({
      success: true,
      data: { ...sesion, movimientos: movimientos.rows },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/caja/movimiento — registrar ingreso o egreso manual
const registrarMovimiento = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { tipo, monto, concepto } = req.body;

    if (!tipo || !['ingreso', 'egreso'].includes(tipo)) {
      return res.status(400).json({ success: false, message: 'tipo debe ser ingreso o egreso.' });
    }

    if (!concepto?.trim()) {
      return res.status(400).json({ success: false, message: 'concepto es obligatorio.' });
    }

    let montoValido;
    try {
      montoValido = parsePrecioConDefault(monto, 'monto', 0);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    if (montoValido <= 0) {
      return res.status(400).json({ success: false, message: 'El monto debe ser mayor a cero.' });
    }

    await client.query('BEGIN');

    // Bloquear la sesión con FOR UPDATE para evitar registrar en una sesión que se cierra
    const sesionResult = await client.query(
      `SELECT id FROM sesiones_caja WHERE usuario_id = $1 AND estado = 'abierta' LIMIT 1 FOR UPDATE`,
      [req.user.id]
    );
    if (!sesionResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'No tienes una sesión de caja abierta.' });
    }

    const result = await client.query(
      `INSERT INTO movimientos_caja (sesion_id, tipo, monto, concepto)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [sesionResult.rows[0].id, tipo, montoValido, concepto.trim()]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Movimiento registrado.',
      data: result.rows[0],
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

// GET /api/caja/movimientos — movimientos de la sesión activa
const getMovimientos = async (req, res, next) => {
  try {
    const { sesion_id, tipo, limite } = req.query;
    const params = [];
    const condiciones = [];
    let idx = 1;

    if (sesion_id) {
      // Si se especifica sesión, verificar acceso
      const id = parseInt(sesion_id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ success: false, message: 'sesion_id debe ser un número.' });
      }

      if (req.user.rol !== 'admin') {
        const sesion = await pool.query(
          'SELECT usuario_id FROM sesiones_caja WHERE id = $1',
          [id]
        );
        if (sesion.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'Sesión no encontrada.' });
        }
        if (sesion.rows[0].usuario_id !== req.user.id) {
          return res.status(403).json({ success: false, message: 'No tienes acceso a esta sesión.' });
        }
      }

      params.push(id);
      condiciones.push(`m.sesion_id = $${idx}`);
      idx++;
    } else {
      // Sin sesion_id: mostrar movimientos de la sesión activa del usuario
      const sesion = await sesionAbierta(req.user.id);
      if (!sesion) {
        return res.status(404).json({ success: false, message: 'No tienes una sesión de caja abierta.' });
      }
      params.push(sesion.id);
      condiciones.push(`m.sesion_id = $${idx}`);
      idx++;
    }

    if (tipo && ['ingreso', 'egreso'].includes(tipo)) {
      params.push(tipo);
      condiciones.push(`m.tipo = $${idx}`);
      idx++;
    }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
    const limit = Math.min(parseInt(limite, 10) || 100, 500);

    const result = await pool.query(
      `SELECT m.id, m.sesion_id, m.tipo, m.monto, m.concepto,
              m.referencia_venta_id, m.created_at
       FROM movimientos_caja m
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

// POST /api/caja/cerrar
const cerrarSesion = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { monto_cierre, observaciones } = req.body;

    let montoCierre;
    try {
      montoCierre = parsePrecioConDefault(monto_cierre, 'monto_cierre', 0);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    if (montoCierre < 0) {
      return res.status(400).json({ success: false, message: 'monto_cierre no puede ser negativo.' });
    }

    await client.query('BEGIN');

    // Bloquear la sesión con FOR UPDATE para evitar doble cierre simultáneo
    const sesionResult = await client.query(
      `SELECT id, monto_apertura FROM sesiones_caja
       WHERE usuario_id = $1 AND estado = 'abierta'
       LIMIT 1
       FOR UPDATE`,
      [req.user.id]
    );

    if (sesionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'No tienes una sesión de caja abierta.' });
    }

    const sesion = sesionResult.rows[0];
    const montoEsperado = await calcularMontoEsperado(client, sesion.id, sesion.monto_apertura);
    const diferencia = montoCierre - montoEsperado;

    // Segunda línea de defensa: verificar rowCount por si la sesión fue cerrada entre SELECT y UPDATE
    const update = await client.query(
      `UPDATE sesiones_caja
       SET estado         = 'cerrada',
           monto_cierre   = $1,
           monto_esperado = $2,
           diferencia     = $3,
           cierre_at      = NOW(),
           observaciones  = COALESCE($4, observaciones)
       WHERE id = $5 AND estado = 'abierta'
       RETURNING *`,
      [montoCierre, montoEsperado, diferencia, observaciones?.trim() || null, sesion.id]
    );

    if (update.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'La sesión ya fue cerrada por otra solicitud.' });
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Sesión de caja cerrada.',
      data: update.rows[0],
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

module.exports = {
  abrirSesion,
  getSesionActiva,
  getSesiones,
  getSesionById,
  registrarMovimiento,
  getMovimientos,
  cerrarSesion,
};
