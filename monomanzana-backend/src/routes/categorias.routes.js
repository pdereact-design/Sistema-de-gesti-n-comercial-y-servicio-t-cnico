const router = require('express').Router();
const {
  getCategorias, getCategoriaById,
  createCategoria, updateCategoria, toggleEstadoCategoria,
} = require('../controllers/categorias.controller');
const { verifyToken, verifyRole } = require('../middlewares/auth');

router.use(verifyToken);

// Consultar — todos los roles autenticados
router.get('/',    verifyRole('admin', 'ventas', 'almacen', 'tecnico'), getCategorias);
router.get('/:id', verifyRole('admin', 'ventas', 'almacen', 'tecnico'), getCategoriaById);

// Administrar — admin y almacen
router.post('/',             verifyRole('admin', 'almacen'), createCategoria);
router.put('/:id',           verifyRole('admin', 'almacen'), updateCategoria);
router.patch('/:id/estado',  verifyRole('admin', 'almacen'), toggleEstadoCategoria);

module.exports = router;
