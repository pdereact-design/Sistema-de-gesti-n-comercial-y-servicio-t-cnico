const router = require('express').Router();
const { login, me, cambiarPassword } = require('../controllers/auth.controller');
const { verifyToken } = require('../middlewares/auth');

// Ruta pública
router.post('/login', login);

// Rutas protegidas
router.get('/me', verifyToken, me);
router.post('/cambiar-password', verifyToken, cambiarPassword);

module.exports = router;
