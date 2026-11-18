const router = require('express').Router();
const {
  crearOrden,
  getOrdenes,
  getOrdenById,
  actualizarDiagnostico,
  asignarTecnico,
  actualizarEstado,
  agregarRepuesto,
  cobrarOrden,
  cancelarOrden,
} = require('../controllers/servicio.controller');
const { verifyToken, verifyRole } = require('../middlewares/auth');

router.use(verifyToken);

// Consultar — admin, ventas y tecnico
router.get('/',    verifyRole('admin', 'ventas', 'tecnico'), getOrdenes);
router.get('/:id', verifyRole('admin', 'ventas', 'tecnico'), getOrdenById);

// Crear — admin, ventas y tecnico (cualquiera puede recibir un equipo)
router.post('/', verifyRole('admin', 'ventas', 'tecnico'), crearOrden);

// Gestionar — admin y tecnico
router.put('/:id/diagnostico',    verifyRole('admin', 'tecnico'), actualizarDiagnostico);
router.patch('/:id/estado',       verifyRole('admin', 'tecnico'), actualizarEstado);
router.post('/:id/repuestos',     verifyRole('admin', 'tecnico'), agregarRepuesto);

// Asignar técnico — solo admin
router.patch('/:id/tecnico',      verifyRole('admin'), asignarTecnico);

// Cobrar — admin y ventas (quien entrega cobra)
router.post('/:id/cobrar',        verifyRole('admin', 'ventas'), cobrarOrden);

// Cancelar — solo admin
router.post('/:id/cancelar',      verifyRole('admin'), cancelarOrden);

module.exports = router;
