const router = require('express').Router();
const {
  getModelos, getModeloById,
  createModelo, updateModelo, toggleEstadoModelo,
} = require('../controllers/modelos.controller');
const { verifyToken, verifyRole } = require('../middlewares/auth');

router.use(verifyToken);

// Consultar — todos los roles autenticados
router.get('/',    verifyRole('admin', 'ventas', 'almacen', 'tecnico'), getModelos);
router.get('/:id', verifyRole('admin', 'ventas', 'almacen', 'tecnico'), getModeloById);

// Administrar — admin y almacen
router.post('/',             verifyRole('admin', 'almacen'), createModelo);
router.put('/:id',           verifyRole('admin', 'almacen'), updateModelo);
router.patch('/:id/estado',  verifyRole('admin', 'almacen'), toggleEstadoModelo);

module.exports = router;
