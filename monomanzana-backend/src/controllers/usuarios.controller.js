const bcrypt = require('bcryptjs');
const pool   = require('../config/db');

// Roles válidos del sistema
const ROLES_VALIDOS = ['admin', 'ventas', 'almacen', 'tecnico'];

// Validar formato de email
const esEmailValido = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// GET /api/usuarios?buscar=texto
// Lista todos los usuarios. Acepta ?buscar= para filtrar por nombre o email.
const getUsuarios = async (req, res, next) => {
  try {
    const { buscar } = req.query;

    let query = `
      SELECT u.id, u.nombre, u.apellido, u.email, r.nombre AS rol, u.activo, u.created_at
      FROM usuarios u
      JOIN roles r ON u.rol_id = r.id
    `;
    const params = [];

    if (buscar && buscar.trim()) {
      params.push(`%${buscar.trim()}%`);
      query += ` WHERE u.nombre ILIKE $1 OR u.apellido ILIKE $1 OR u.email ILIKE $1`;
    }

    query += ' ORDER BY u.nombre ASC';

    const result = await pool.query(query, params);
    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/usuarios/roles — lista los roles disponibles
const getRoles = async (req, res, next) => {
  try {
    const result = await pool.query('SELECT id, nombre, descripcion FROM roles ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/usuarios/:id
const getUsuarioById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const result = await pool.query(
      `SELECT u.id, u.nombre, u.apellido, u.email, r.nombre AS rol, u.activo, u.created_at, u.updated_at
       FROM usuarios u
       JOIN roles r ON u.rol_id = r.id
       WHERE u.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// POST /api/usuarios — registrar nuevo usuario
const createUsuario = async (req, res, next) => {
  try {
    const { nombre, apellido, email, password, rol_id } = req.body;

    // Validar campos requeridos
    if (!nombre || !apellido || !email || !password || !rol_id) {
      return res.status(400).json({ success: false, message: 'Todos los campos son requeridos: nombre, apellido, email, password, rol_id.' });
    }

    if (!esEmailValido(email)) {
      return res.status(400).json({ success: false, message: 'El formato del email no es válido.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 8 caracteres.' });
    }

    // Verificar que el rol existe
    const rolResult = await pool.query('SELECT id, nombre FROM roles WHERE id = $1', [rol_id]);
    if (rolResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'El rol especificado no existe.' });
    }

    // Verificar email duplicado
    const existe = await pool.query(
      'SELECT id FROM usuarios WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    if (existe.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'El email ya está registrado.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO usuarios (nombre, apellido, email, password, rol_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, apellido, email, rol_id, activo, created_at`,
      [nombre.trim(), apellido.trim(), email.toLowerCase().trim(), hash, rol_id]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Usuario registrado correctamente.',
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/usuarios/:id — editar información del usuario
const updateUsuario = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const { nombre, apellido, email, rol_id } = req.body;

    if (!nombre || !apellido || !email || !rol_id) {
      return res.status(400).json({ success: false, message: 'Todos los campos son requeridos: nombre, apellido, email, rol_id.' });
    }

    if (!esEmailValido(email)) {
      return res.status(400).json({ success: false, message: 'El formato del email no es válido.' });
    }

    // Verificar que el usuario existe
    const usuarioActual = await pool.query('SELECT id FROM usuarios WHERE id = $1', [id]);
    if (usuarioActual.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    // Verificar que el rol existe
    const rolResult = await pool.query('SELECT id FROM roles WHERE id = $1', [rol_id]);
    if (rolResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'El rol especificado no existe.' });
    }

    // Verificar email duplicado en otro usuario
    const emailDuplicado = await pool.query(
      'SELECT id FROM usuarios WHERE email = $1 AND id <> $2',
      [email.toLowerCase().trim(), id]
    );
    if (emailDuplicado.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'El email ya está en uso por otro usuario.' });
    }

    const result = await pool.query(
      `UPDATE usuarios
       SET nombre=$1, apellido=$2, email=$3, rol_id=$4, updated_at=NOW()
       WHERE id=$5
       RETURNING id, nombre, apellido, email, rol_id, activo, updated_at`,
      [nombre.trim(), apellido.trim(), email.toLowerCase().trim(), rol_id, id]
    );

    res.json({ success: true, data: result.rows[0], message: 'Usuario actualizado correctamente.' });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/usuarios/:id/estado — activar o desactivar usuario
const toggleEstadoUsuario = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    // No se permite desactivar la propia cuenta
    if (id === req.user.id) {
      return res.status(400).json({ success: false, message: 'No puedes cambiar el estado de tu propia cuenta.' });
    }

    const { activo } = req.body;
    if (typeof activo !== 'boolean') {
      return res.status(400).json({ success: false, message: 'El campo activo debe ser true o false.' });
    }

    const result = await pool.query(
      `UPDATE usuarios SET activo=$1, updated_at=NOW()
       WHERE id=$2
       RETURNING id, nombre, apellido, email, activo`,
      [activo, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    const estado = activo ? 'activado' : 'desactivado';
    res.json({ success: true, data: result.rows[0], message: `Usuario ${estado} correctamente.` });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/usuarios/:id — desactiva el usuario permanentemente, no lo elimina
const deleteUsuario = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    if (id === req.user.id) {
      return res.status(400).json({ success: false, message: 'No puedes desactivar tu propia cuenta.' });
    }

    const result = await pool.query(
      'UPDATE usuarios SET activo=false, updated_at=NOW() WHERE id=$1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    res.json({ success: true, message: 'Usuario desactivado correctamente.' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getUsuarios,
  getRoles,
  getUsuarioById,
  createUsuario,
  updateUsuario,
  toggleEstadoUsuario,
  deleteUsuario,
};
