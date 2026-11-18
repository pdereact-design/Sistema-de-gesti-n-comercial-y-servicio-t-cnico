/**
 * tests/check-modules.js
 * Verifica que todos los módulos cargan sin errores de sintaxis.
 * Ejecutar: node tests/check-modules.js
 */
const modulos = [
  '../src/middlewares/errorHandler',
  '../src/middlewares/auth',
  '../src/controllers/auth.controller',
  '../src/controllers/usuarios.controller',
  '../src/controllers/clientes.controller',
  '../src/controllers/categorias.controller',
  '../src/controllers/modelos.controller',
  '../src/controllers/productos.controller',
  '../src/controllers/variantes.controller',
  '../src/controllers/inventario.controller',
  '../src/controllers/ventas.controller',
  '../src/controllers/caja.controller',
  '../src/controllers/servicio.controller',
  '../src/services/inventario.service',
  '../src/services/ventas.service',
  '../src/services/servicio.service',
  '../src/routes/auth.routes',
  '../src/routes/usuarios.routes',
  '../src/routes/clientes.routes',
  '../src/routes/categorias.routes',
  '../src/routes/modelos.routes',
  '../src/routes/productos.routes',
  '../src/routes/inventario.routes',
  '../src/routes/ventas.routes',
  '../src/routes/caja.routes',
  '../src/routes/servicio.routes',
];

let errores = 0;
for (const m of modulos) {
  try {
    require(m);
    console.log(`   ${m}`);
  } catch (e) {
    console.error(`   ${m} → ${e.message}`);
    errores++;
  }
}

if (errores === 0) {
  console.log('\n Todos los módulos cargaron correctamente.');
} else {
  console.error(`\n ${errores} módulo(s) con errores.`);
  process.exit(1);
}
