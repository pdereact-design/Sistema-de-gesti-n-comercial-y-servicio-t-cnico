const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const pool   = require('../config/db');

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email y contraseña son requeridos.',
      });
    }

    const result = await pool.query(
      `SELECT u.id, u.nombre, u.apellido, u.email, u.password, r.nombre AS rol
       FROM usuarios u
       JOIN roles r ON u.rol_id = r.id
       WHERE u.email = $1 AND u.activo = true`,
      [email.toLowerCase().trim()]
    );

    // Mismo mensaje para usuario inexistente y contraseña incorrecta,
    // para no revelar si el email está registrado en el sistema.
    const credencialesInvalidas = () =>
      res.status(401).json({ success: false, message: 'Credenciales inválidas.' });

    if (result.rows.length === 0) {
      return credencialesInvalidas();
    }

    const usuario = result.rows[0];
    const passwordValido = await bcrypt.compare(password, usuario.password);

    if (!passwordValido) {
      return credencialesInvalidas();
    }

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    return res.json({
      success: true,
      token,
      usuario: {
        id:       usuario.id,
        nombre:   usuario.nombre,
        apellido: usuario.apellido,
        email:    usuario.email,
        rol:      usuario.rol,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me — devuelve el usuario autenticado sin exponer la contraseña
const me = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.nombre, u.apellido, u.email, r.nombre AS rol, u.created_at
       FROM usuarios u
       JOIN roles r ON u.rol_id = r.id
       WHERE u.id = $1 AND u.activo = true`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado o inactivo.',
      });
    }

    return res.json({ success: true, usuario: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/cambiar-password
const cambiarPassword = async (req, res, next) => {
  try {
    const { password_actual, password_nuevo } = req.body;

    if (!password_actual || !password_nuevo) {
      return res.status(400).json({
        success: false,
        message: 'Se requieren password_actual y password_nuevo.',
      });
    }

    if (password_nuevo.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña nueva debe tener al menos 8 caracteres.',
      });
    }

    if (password_actual === password_nuevo) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña nueva debe ser diferente a la actual.',
      });
    }

    const result = await pool.query(
      'SELECT id, password FROM usuarios WHERE id = $1 AND activo = true',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado.',
      });
    }

    const valido = await bcrypt.compare(password_actual, result.rows[0].password);
    if (!valido) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña actual es incorrecta.',
      });
    }

    const hash = await bcrypt.hash(password_nuevo, 12);
    await pool.query(
      'UPDATE usuarios SET password = $1, updated_at = NOW() WHERE id = $2',
      [hash, req.user.id]
    );

    return res.json({ success: true, message: 'Contraseña actualizada correctamente.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { login, me, cambiarPassword };
