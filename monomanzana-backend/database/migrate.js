/*
 * migrate.js — Ejecuta migraciones SQL pendientes.
 *
 * Crea la tabla "migraciones" si no existe, lee los archivos .sql
 * de database/migrations/ en orden y aplica solo los no registrados.
 * Cada migración se ejecuta dentro de una transacción.
 */
const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const run = async () => {
  const client = await pool.connect();

  let exitCode = 0;

  try {
    console.log('Iniciando migraciones...');

    // Crear tabla de control si no existe
    await client.query(`
      CREATE TABLE IF NOT EXISTS migraciones (
        id          SERIAL PRIMARY KEY,
        nombre      VARCHAR(255) UNIQUE NOT NULL,
        aplicada_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const archivos = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (archivos.length === 0) {
      console.log('No hay archivos de migración en database/migrations/');
      return;
    }

    let aplicadas = 0;
    let omitidas  = 0;

    for (const archivo of archivos) {
      const { rows } = await client.query(
        'SELECT id FROM migraciones WHERE nombre = $1',
        [archivo]
      );

      if (rows.length > 0) {
        console.log(`  Omitida (ya aplicada): ${archivo}`);
        omitidas++;
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, archivo), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO migraciones (nombre) VALUES ($1)', [archivo]);
        await client.query('COMMIT');
        console.log(`  Aplicada: ${archivo}`);
        aplicadas++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  Error en ${archivo}:`, err.message);
        exitCode = 1;
        return;
      }
    }

    console.log(`Migraciones completadas: ${aplicadas} aplicadas, ${omitidas} omitidas.`);
  } catch (err) {
    console.error('Error en el sistema de migraciones:', err.message);
    exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }

  process.exit(exitCode);
};

run();
