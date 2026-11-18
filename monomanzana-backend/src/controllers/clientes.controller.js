const pool = require('../config/db');

// Validar formato de email
const esEmailValido = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Normalizar texto: trim y capitalizar primera letra
const normalizar = (str) => str.trim().replace(/\s+/g, ' ');

// GET /api/clientes?buscar=texto&activo=true
// Acepta ?buscar= para filtrar por nombre, apellido, cedula o telefono
// Acepta ?activo=true|false para filtrar por estado
const getClientes = async (req, res, next) => {
  try {
    const { buscar, activo } = req.query;

    let condiciones = [];
    let params = [];
    let idx = 1;

    if (buscar && buscar.trim()) {
      params.push(`%${buscar.trim()}%`);
      condiciones.push(
        `(c.nombre    ILIKE $${idx}
       OR c.apellido  ILIKE $${idx}
       OR c.cedula    ILIKE $${idx}
       OR c.telefono  ILIKE $${idx})`
      );
      idx++;
    }

    if (activo !== undefined) {
      params.push(activo === 'true');
      condiciones.push(`c.activo = $${idx}`);
      idx++;
    }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT c.id, c.nombre, c.apellido, c.cedula, c.email,
              c.telefono, c.direccion, c.activo, c.created_at
       FROM clientes c
       ${where}
       ORDER BY c.nombre ASC, c.apellido ASC`,
      params
    );

    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/clientes/:id
const getClienteById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const result = await pool.query(
      `SELECT id, nombre, apellido, cedula, email,
              telefono, direccion, activo, created_at, updated_at
       FROM clientes
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// POST /api/clientes
const createCliente = async (req, res, next) => {
  try {
    const { nombre, apellido, cedula, email, telefono, direccion } = req.body;

    if (!nombre || !apellido) {
      return res.status(400).json({ success: false, message: 'Nombre y apellido son obligatorios.' });
    }

    if (!cedula && !telefono) {
      return res.status(400).json({ success: false, message: 'Se requiere al menos cédula o teléfono para identificar al cliente.' });
    }

    if (email && !esEmailValido(email)) {
      return res.status(400).json({ success: false, message: 'El formato del email no es válido.' });
    }

    // Verificar cédula duplicada si se proporcionó
    if (cedula) {
      const dup = await pool.query(
        'SELECT id FROM clientes WHERE cedula = $1',
        [cedula.trim()]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'Ya existe un cliente registrado con esa cédula.' });
      }
    }

    const result = await pool.query(
      `INSERT INTO clientes (nombre, apellido, cedula, email, telefono, direccion)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nombre, apellido, cedula, email, telefono, direccion, activo, created_at`,
      [
        normalizar(nombre),
        normalizar(apellido),
        cedula   ? cedula.trim()          : null,
        email    ? email.toLowerCase().trim() : null,
        telefono ? telefono.trim()        : null,
        direccion ? normalizar(direccion) : null,
      ]
    );

    res.status(201).json({
      success: true,
      data:    result.rows[0],
      message: 'Cliente registrado correctamente.',
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/clientes/:id
const updateCliente = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const { nombre, apellido, cedula, email, telefono, direccion } = req.body;

    if (!nombre || !apellido) {
      return res.status(400).json({ success: false, message: 'Nombre y apellido son obligatorios.' });
    }

    if (email && !esEmailValido(email)) {
      return res.status(400).json({ success: false, message: 'El formato del email no es válido.' });
    }

    // Verificar que el cliente existe
    const existe = await pool.query('SELECT id FROM clientes WHERE id = $1', [id]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado.' });
    }

    // Verificar cédula duplicada en otro cliente
    if (cedula) {
      const dup = await pool.query(
        'SELECT id FROM clientes WHERE cedula = $1 AND id <> $2',
        [cedula.trim(), id]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'Ya existe otro cliente registrado con esa cédula.' });
      }
    }

    const result = await pool.query(
      `UPDATE clientes
       SET nombre    = $1,
           apellido  = $2,
           cedula    = $3,
           email     = $4,
           telefono  = $5,
           direccion = $6,
           updated_at = NOW()
       WHERE id = $7
       RETURNING id, nombre, apellido, cedula, email, telefono, direccion, activo, updated_at`,
      [
        normalizar(nombre),
        normalizar(apellido),
        cedula    ? cedula.trim()             : null,
        email     ? email.toLowerCase().trim(): null,
        telefono  ? telefono.trim()           : null,
        direccion ? normalizar(direccion)     : null,
        id,
      ]
    );

    res.json({
      success: true,
      data:    result.rows[0],
      message: 'Cliente actualizado correctamente.',
    });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/clientes/:id/estado — activar o desactivar cliente
const toggleEstadoCliente = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const { activo } = req.body;
    if (typeof activo !== 'boolean') {
      return res.status(400).json({ success: false, message: 'El campo activo debe ser true o false.' });
    }

    const result = await pool.query(
      `UPDATE clientes
       SET activo = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, nombre, apellido, activo`,
      [activo, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado.' });
    }

    const estado = activo ? 'activado' : 'desactivado';
    res.json({
      success: true,
      data:    result.rows[0],
      message: `Cliente ${estado} correctamente.`,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getClientes,
  getClienteById,
  createCliente,
  updateCliente,
  toggleEstadoCliente,
};
