const router = require('express').Router();
const { crearVenta, getVentas, getVentaById, anularVenta } = require('../controllers/ventas.controller');
const { verifyToken, verifyRole } = require('../middlewares/auth');

router.use(verifyToken);

// Consultar — admin y ventas
router.get('/',     verifyRole('admin', 'ventas'), getVentas);
router.get('/:id',  verifyRole('admin', 'ventas'), getVentaById);

// Registrar — admin y ventas
router.post('/',    verifyRole('admin', 'ventas'), crearVenta);

// Anular — solo admin
router.post('/:id/anular', verifyRole('admin'), anularVenta);

module.exports = router;
