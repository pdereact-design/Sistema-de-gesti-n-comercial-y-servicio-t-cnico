const jwt  = require('jsonwebtoken');
const pool = require('../config/db');

// Valida el JWT y consulta PostgreSQL para confirmar que el usuario existe,
// está activo y obtiene su rol actual. Se ejecuta en cada solicitud autenticada.
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Acceso denegado. Se requiere token de autenticación.',
    });
  }

  // Verificar firma y expiración del JWT antes de consultar la base de datos
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'La sesión ha expirado. Inicia sesión nuevamente.',
      });
    }
    return res.status(403).json({
      success: false,
      message: 'Token inválido.',
    });
  }

  // Consultar el estado actual del usuario para bloquear accesos si fue
  // desactivado o si su rol cambió después de que se emitió el token
  const result = await pool.query(
    `SELECT u.id, u.email, u.activo, r.nombre AS rol
     FROM usuarios u
     JOIN roles r ON u.rol_id = r.id
     WHERE u.id = $1`,
    [decoded.id]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({
      success: false,
      message: 'Usuario no encontrado.',
    });
  }

  const usuario = result.rows[0];

  if (!usuario.activo) {
    return res.status(401).json({
      success: false,
      message: 'Cuenta desactivada. Contacta al administrador.',
    });
  }

  // req.user se popula con datos actuales de la DB, no del token
  req.user = {
    id:    usuario.id,
    email: usuario.email,
    rol:   usuario.rol,
  };

  next();
};

// Verifica que el rol del usuario esté dentro de los permitidos para la ruta
const verifyRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).json({
        success: false,
        message: `Acceso denegado. Roles permitidos: ${roles.join(', ')}.`,
      });
    }
    next();
  };
};

module.exports = { verifyToken, verifyRole };
