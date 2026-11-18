const router = require('express').Router();
const {
  getProductos, getProductoById,
  createProducto, updateProducto, toggleEstadoProducto,
} = require('../controllers/productos.controller');
const {
  getVariantes, getVarianteById,
  createVariante, updateVariante, toggleEstadoVariante,
} = require('../controllers/variantes.controller');
const { verifyToken, verifyRole } = require('../middlewares/auth');

router.use(verifyToken);

// Consultar productos — ventas, almacen, tecnico y admin
router.get('/',    verifyRole('admin', 'ventas', 'almacen', 'tecnico'), getProductos);
router.get('/:id', verifyRole('admin', 'ventas', 'almacen', 'tecnico'), getProductoById);

// Administrar productos — admin y almacen
router.post('/',            verifyRole('admin', 'almacen'), createProducto);
router.put('/:id',          verifyRole('admin', 'almacen'), updateProducto);
router.patch('/:id/estado', verifyRole('admin', 'almacen'), toggleEstadoProducto);

// Variantes — anidadas bajo /productos/:productoId/variantes
router.get('/:productoId/variantes',              verifyRole('admin', 'ventas', 'almacen', 'tecnico'), getVariantes);
router.get('/:productoId/variantes/:id',          verifyRole('admin', 'ventas', 'almacen', 'tecnico'), getVarianteById);
router.post('/:productoId/variantes',             verifyRole('admin', 'almacen'), createVariante);
router.put('/:productoId/variantes/:id',          verifyRole('admin', 'almacen'), updateVariante);
router.patch('/:productoId/variantes/:id/estado', verifyRole('admin', 'almacen'), toggleEstadoVariante);

module.exports = router;
