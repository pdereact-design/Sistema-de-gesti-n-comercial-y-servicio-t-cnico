const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const pool         = require('./config/db');
const errorHandler = require('./middlewares/errorHandler');

// Rutas
const authRoutes       = require('./routes/auth.routes');
const usuariosRoutes   = require('./routes/usuarios.routes');
const clientesRoutes   = require('./routes/clientes.routes');
const categoriasRoutes = require('./routes/categorias.routes');
const modelosRoutes    = require('./routes/modelos.routes');
const productosRoutes  = require('./routes/productos.routes');
const inventarioRoutes = require('./routes/inventario.routes');
const ventasRoutes     = require('./routes/ventas.routes');
const cajaRoutes       = require('./routes/caja.routes');
const servicioRoutes   = require('./routes/servicio.routes');

const app = express();

// Middlewares globales
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Verificación de estado del servidor y la base de datos
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS db_time');
    res.json({
      status:      'OK',
      message:     'API funcionando',
      db:          'Conectado',
      db_time:     result.rows[0].db_time,
      server_time: new Date(),
    });
  } catch (err) {
    res.status(503).json({
      status:  'ERROR',
      message: 'API activa pero sin conexión a la base de datos',
      error:   err.message,
    });
  }
});

// Registro de rutas
app.use('/api/auth',       authRoutes);
app.use('/api/usuarios',   usuariosRoutes);
app.use('/api/clientes',   clientesRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/modelos',    modelosRoutes);
app.use('/api/productos',  productosRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/ventas',     ventasRoutes);
app.use('/api/caja',       cajaRoutes);
app.use('/api/servicio',   servicioRoutes);

// Ruta no encontrada
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// Manejador global de errores
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
  console.log(`Entorno: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
