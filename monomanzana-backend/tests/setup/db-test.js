// Gestión de la base de datos de pruebas.
// Cada llamada a crearEntorno() devuelve un entorno completamente independiente.
// Nunca toca monomanzana_db ni ninguna base sin el sufijo _test.

const { Pool, Client } = require('pg');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

// El nombre de producción se lee del archivo .env para no verse afectado
// por mutaciones de process.env durante las pruebas.
function leerDBProduccion() {
  try {
    const envPath = path.join(__dirname, '../../.env');
    const lineas  = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const linea of lineas) {
      const m = linea.match(/^DB_NAME\s*=\s*(.+)$/);
      if (m) return m[1].trim();
    }
  } catch (_) {}
  return 'monomanzana_db'; // valor por defecto si no se puede leer el .env
}

const DB_PRODUCCION = leerDBProduccion();
const TEST_DB       = 'monomanzana_test';

function verificarNombreSeguro(nombre) {
  if (!nombre || typeof nombre !== 'string' || !/^[a-z0-9_]+$/.test(nombre)) {
    throw new Error(`Nombre de DB inválido: "${nombre}"`);
  }
  if (!nombre.endsWith('_test')) {
    throw new Error(`"${nombre}" no tiene el sufijo _test requerido para bases de prueba.`);
  }
  if (nombre === DB_PRODUCCION) {
    throw new Error(`"${nombre}" coincide con la DB de producción. Abortando.`);
  }
}

function clienteAdmin() {
  return new Client({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    database: 'postgres',
    user:     process.env.DB_ADMIN_USER || process.env.DB_USER,
    password: process.env.DB_ADMIN_PASSWORD || process.env.DB_PASSWORD,
  });
}

async function crearDB() {
  verificarNombreSeguro(TEST_DB);
  const admin = clienteAdmin();
  await admin.connect();
  try {
    const { rows } = await admin.query(
      'SELECT datname FROM pg_database WHERE datname = $1', [TEST_DB]
    );
    if (rows.length > 0) {
      // Solo eliminar si tiene la tabla migraciones (es nuestra)
      const tmp = new Pool({
        host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '5432', 10),
        database: TEST_DB,
        user: process.env.DB_ADMIN_USER || process.env.DB_USER,
        password: process.env.DB_ADMIN_PASSWORD || process.env.DB_PASSWORD,
      });
      let esPrueba = false;
      try {
        const r = await tmp.query("SELECT to_regclass('public.migraciones') AS t");
        esPrueba = r.rows[0].t !== null;
      } finally { await tmp.end(); }
      if (!esPrueba) {
        throw new Error(`"${TEST_DB}" existe pero no parece una base de pruebas anterior. Elimínala manualmente.`);
      }
      await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [TEST_DB]);
      await admin.query(`DROP DATABASE "${TEST_DB}"`);
    }
    await admin.query(`CREATE DATABASE "${TEST_DB}" ENCODING 'UTF8'`);
  } finally { await admin.end(); }
}

async function migrar(pool) {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS migraciones (id SERIAL PRIMARY KEY, nombre VARCHAR(255) UNIQUE NOT NULL, aplicada_at TIMESTAMP DEFAULT NOW())`);
    const dir = path.join(__dirname, '../../database/migrations');
    for (const archivo of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      const sql = fs.readFileSync(path.join(dir, archivo), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO migraciones (nombre) VALUES ($1)', [archivo]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; }
    }
  } finally { client.release(); }
}

async function sembrar(pool) {
  const bcrypt = require('bcryptjs');
  const c = await pool.connect();
  try {
    const [hA, hV, hT] = await Promise.all([
      bcrypt.hash('TestAdmin123', 10),
      bcrypt.hash('TestVentas123', 10),
      bcrypt.hash('TestTecnico123', 10),
    ]);
    await c.query(`INSERT INTO usuarios (nombre, apellido, email, password, rol_id) VALUES ('Admin','Test','admin@test.com',$1,(SELECT id FROM roles WHERE nombre='admin')),('Vendedor','Test','ventas@test.com',$2,(SELECT id FROM roles WHERE nombre='ventas')),('Tecnico','Test','tecnico@test.com',$3,(SELECT id FROM roles WHERE nombre='tecnico'))`, [hA, hV, hT]);
    await c.query(`INSERT INTO productos (codigo,nombre,tipo,marca,categoria_id) VALUES ('REP-TEST-001','Pantalla iPhone Test','repuesto','Test',(SELECT id FROM categorias WHERE nombre='Repuesto'))`);
    await c.query(`INSERT INTO variantes_producto (producto_id,sku,precio_venta,precio_compra,stock_minimo) VALUES ((SELECT id FROM productos WHERE codigo='REP-TEST-001'),'REP-TEST-001-VAR',50.00,25.00,1)`);
    await c.query(`INSERT INTO inventario (variante_id,producto_id,cantidad) VALUES ((SELECT id FROM variantes_producto WHERE sku='REP-TEST-001-VAR'),(SELECT id FROM productos WHERE codigo='REP-TEST-001'),10)`);
    await c.query(`INSERT INTO productos (codigo,nombre,tipo,marca,categoria_id,modelo_iphone_id) VALUES ('IPH-TEST-001','iPhone 14 Test','iphone','Apple',(SELECT id FROM categorias WHERE nombre='iPhone'),(SELECT id FROM modelos_iphone WHERE nombre='iPhone 14'))`);
    await c.query(`INSERT INTO variantes_producto (producto_id,sku,precio_venta,precio_compra,almacenamiento,color,condicion,stock_minimo) VALUES ((SELECT id FROM productos WHERE codigo='IPH-TEST-001'),'IPH-TEST-001-VAR',950.00,750.00,'128GB','Negro','nuevo',1)`);
    await c.query(`INSERT INTO unidades_fisicas (variante_id,tipo_identificador,identificador,estado) VALUES ((SELECT id FROM variantes_producto WHERE sku='IPH-TEST-001-VAR'),'imei','TEST-IMEI-0000001','disponible')`);
    await c.query(`INSERT INTO clientes (nombre,apellido,cedula,telefono) VALUES ('Cliente','Test','0999999999','0991111111')`);
  } finally { c.release(); }
}

async function destruirDB(pool) {
  verificarNombreSeguro(TEST_DB);

  // Cerrar el pool de pruebas
  if (pool) await pool.end();

// Cerrar el pool de la app si está en caché para evitar conexiones colgadas
  try {
    const dbModule = require.resolve('../../src/config/db');
    if (require.cache[dbModule]) {
      const appPool = require('../../src/config/db');
      await appPool.end();
      delete require.cache[dbModule];
    }
  } catch (_) {}

  const admin = clienteAdmin();
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB]
    );
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
  } finally { await admin.end(); }
}

// Crea un pool conectado a TEST_DB y aplica migraciones y datos de prueba.
async function crearEntorno() {
  await crearDB();
  const pool = new Pool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    database: TEST_DB,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  try {
    await migrar(pool);
    await sembrar(pool);
  } catch (e) {
    await pool.end();
    throw e;
  }
  return pool;
}

module.exports = { crearEntorno, destruirDB, TEST_DB };
