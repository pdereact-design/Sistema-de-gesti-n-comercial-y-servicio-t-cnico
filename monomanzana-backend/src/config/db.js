// Configuración del pool de conexiones a PostgreSQL
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

pool.on('connect', () => {
  console.log('Conexión a PostgreSQL establecida');
});

pool.on('error', (err) => {
  console.error('Error en el pool de PostgreSQL:', err.message);
});

module.exports = pool;
