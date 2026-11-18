// Manejador global de errores — debe registrarse al final de app.js
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const status  = err.status || err.statusCode || 500;
  const message = err.message || 'Error interno del servidor';

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} -> ${status}: ${message}`);

  if (status === 500 && err.stack) {
    console.error(err.stack);
  }

  res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
