const router = require('express').Router();
const {
  getClientes,
  getClienteById,
  createCliente,
  updateCliente,
  toggleEstadoCliente,
} = require('../controllers/clientes.controller');
const { verifyToken, verifyRole } = require('../middlewares/auth');

// Todas las rutas requieren autenticación
router.use(verifyToken);

// Listar y buscar clientes — admin, ventas y tecnico
router.get(
  '/',
  verifyRole('admin', 'ventas', 'tecnico'),
  getClientes
);

// Consultar cliente por ID — admin, ventas y tecnico
router.get(
  '/:id',
  verifyRole('admin', 'ventas', 'tecnico'),
  getClienteById
);

// Registrar cliente — admin y ventas
router.post(
  '/',
  verifyRole('admin', 'ventas'),
  createCliente
);

// Editar cliente — admin y ventas
router.put(
  '/:id',
  verifyRole('admin', 'ventas'),
  updateCliente
);

// Activar o desactivar cliente — solo admin
router.patch(
  '/:id/estado',
  verifyRole('admin'),
  toggleEstadoCliente
);

module.exports = router;
