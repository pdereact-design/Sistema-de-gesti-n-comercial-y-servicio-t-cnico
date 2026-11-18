/*
 * seed.js — Crea el usuario administrador inicial.
 * La contraseña se lee desde ADMIN_PASSWORD en .env. Idempotente.
 */
const bcrypt = require('bcryptjs');
const pool   = require('../src/config/db');
require('dotenv').config();

const seed = async () => {
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword || adminPassword.length < 8) {
    console.error('Error: define ADMIN_PASSWORD en .env con al menos 8 caracteres.');
    process.exit(1);
  }

  let exitCode = 0;

  try {
    console.log('Iniciando seed...');

    const existe = await pool.query(
      "SELECT id FROM usuarios WHERE email = 'admin@monomanzana.com'"
    );

    if (existe.rows.length > 0) {
      console.log('El usuario administrador ya existe. Seed omitido.');
      return;
    }

    const rol = await pool.query("SELECT id FROM roles WHERE nombre = 'admin'");

    if (rol.rows.length === 0) {
      console.error('Error: rol admin no encontrado. Ejecuta primero: npm run db:migrate');
      exitCode = 1;
      return;
    }

    const hash = await bcrypt.hash(adminPassword, 12);

    await pool.query(
      `INSERT INTO usuarios (nombre, apellido, email, password, rol_id)
       VALUES ($1, $2, $3, $4, $5)`,
      ['Admin', 'MonoManzana', 'admin@monomanzana.com', hash, rol.rows[0].id]
    );

    console.log('Usuario administrador creado.');
    console.log('Email: admin@monomanzana.com');
    console.log('Cambia la contraseña en el primer inicio de sesion.');
  } catch (err) {
    console.error('Error en seed:', err.message);
    exitCode = 1;
  } finally {
    await pool.end();
  }

  process.exit(exitCode);
};

seed();
