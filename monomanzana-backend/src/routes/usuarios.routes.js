const router = require('express').Router();
const {
  getUsuarios,
  getRoles,
  getUsuarioById,
  createUsuario,
  updateUsuario,
  toggleEstadoUsuario,
  deleteUsuario,
} = require('../controllers/usuarios.controller');
const { verifyToken, verifyRole } = require('../middlewares/auth');

// Todas las rutas requieren autenticación
router.use(verifyToken);

// Consultar roles — disponible para cualquier usuario autenticado
router.get('/roles', getRoles);

// Operaciones sobre usuarios — solo admin
router.get('/',            verifyRole('admin'), getUsuarios);
router.get('/:id',         verifyRole('admin'), getUsuarioById);
router.post('/',           verifyRole('admin'), createUsuario);
router.put('/:id',         verifyRole('admin'), updateUsuario);
router.patch('/:id/estado',verifyRole('admin'), toggleEstadoUsuario);
router.delete('/:id',      verifyRole('admin'), deleteUsuario);

module.exports = router;
