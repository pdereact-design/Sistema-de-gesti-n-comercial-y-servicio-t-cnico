const router = require('express').Router();
const {
  getInventario,
  getInventarioByVariante,
  getAlertas,
  getMovimientos,
  getUnidades,
  entrada,
  salida,
  ajuste,
  cambiarEstadoUnidad,
} = require('../controllers/inventario.controller');
const { verifyToken, verifyRole } = require('../middlewares/auth');

// Todas las rutas requieren autenticación
router.use(verifyToken);

// Consultas — todos los roles
router.get('/',                     verifyRole('admin', 'ventas', 'almacen', 'tecnico'), getInventario);
router.get('/alertas',              verifyRole('admin', 'ventas', 'almacen', 'tecnico'), getAlertas);
router.get('/movimientos',          verifyRole('admin', 'ventas', 'almacen', 'tecnico'), getMovimientos);
router.get('/unidades',             verifyRole('admin', 'ventas', 'almacen', 'tecnico'), getUnidades);
router.get('/:varianteId',          verifyRole('admin', 'ventas', 'almacen', 'tecnico'), getInventarioByVariante);

// Operaciones — admin y almacen
router.post('/entrada',            verifyRole('admin', 'almacen'), entrada);
router.post('/salida',             verifyRole('admin', 'almacen'), salida);
router.post('/ajuste',             verifyRole('admin', 'almacen'), ajuste);
router.patch('/unidades/:id/estado', verifyRole('admin', 'almacen', 'tecnico'), cambiarEstadoUnidad);

module.exports = router;
