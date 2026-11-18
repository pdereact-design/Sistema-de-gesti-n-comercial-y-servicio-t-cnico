/*
 * setup.js — Crea la base de datos si no existe.
 * Requiere DB_ADMIN_USER y DB_ADMIN_PASSWORD con permiso CREATEDB.
 */
const { Client } = require('pg');
require('dotenv').config();

// Valida el nombre de la base de datos y lo escapa como identificador SQL
const escapeIdentifier = (name) => {
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(
      `DB_NAME "${name}" contiene caracteres no permitidos. ` +
      'Solo se aceptan letras minúsculas, dígitos y guión bajo.'
    );
  }
  return `"${name.replace(/"/g, '""')}"`;
};

const setup = async () => {
  const dbName    = process.env.DB_NAME;
  const adminUser = process.env.DB_ADMIN_USER || process.env.DB_USER;
  const adminPass = process.env.DB_ADMIN_PASSWORD || process.env.DB_PASSWORD;

  if (!dbName || !adminUser || !adminPass) {
    console.error('Error: faltan variables en .env (DB_NAME, DB_ADMIN_USER, DB_ADMIN_PASSWORD).');
    process.exit(1);
  }

  let safeIdentifier;
  try {
    safeIdentifier = escapeIdentifier(dbName);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }

  // Conectar a "postgres" para poder consultar pg_database y crear la base de datos
  const client = new Client({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    database: 'postgres',
    user:     adminUser,
    password: adminPass,
  });

  let exitCode = 0;

  try {
    await client.connect();
    console.log(`Conectado como "${adminUser}" a PostgreSQL`);

    const result = await client.query(
      'SELECT datname FROM pg_database WHERE datname = $1',
      [dbName]
    );

    if (result.rows.length > 0) {
      console.log(`La base de datos ${safeIdentifier} ya existe.`);
    } else {
      // CREATE DATABASE no admite parámetros; se usa el identificador validado y escapado
      await client.query(`CREATE DATABASE ${safeIdentifier} ENCODING 'UTF8'`);
      console.log(`Base de datos ${safeIdentifier} creada correctamente.`);
    }

    console.log('Siguiente paso: npm run db:migrate');
  } catch (err) {
    console.error('Error en setup:', err.message);

    if (err.message.includes('password authentication failed')) {
      console.error('La contraseña en DB_ADMIN_PASSWORD no coincide con el usuario PostgreSQL.');
    }

    exitCode = 1;
  } finally {
    await client.end();
  }

  process.exit(exitCode);
};

setup();
