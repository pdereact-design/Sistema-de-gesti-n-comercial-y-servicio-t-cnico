const router = require('express').Router();
const {
  abrirSesion,
  getSesionActiva,
  getSesiones,
  getSesionById,
  registrarMovimiento,
  getMovimientos,
  cerrarSesion,
} = require('../controllers/caja.controller');
const { verifyToken, verifyRole } = require('../middlewares/auth');

router.use(verifyToken);

// Consultas — admin y ventas pueden ver el historial
router.get('/sesiones',          verifyRole('admin', 'ventas'), getSesiones);
router.get('/sesiones/:id',      verifyRole('admin', 'ventas'), getSesionById);
router.get('/sesion-activa',     verifyRole('admin', 'ventas'), getSesionActiva);
router.get('/movimientos',       verifyRole('admin', 'ventas'), getMovimientos);

// Operaciones — admin y ventas gestionan la caja
router.post('/abrir',            verifyRole('admin', 'ventas'), abrirSesion);
router.post('/movimiento',       verifyRole('admin', 'ventas'), registrarMovimiento);
router.post('/cerrar',           verifyRole('admin', 'ventas'), cerrarSesion);

module.exports = router;
