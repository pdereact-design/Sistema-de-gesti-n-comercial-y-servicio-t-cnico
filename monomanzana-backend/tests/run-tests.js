// Runner secuencial de las tres suites de pruebas.
// Cada suite crea su DB, levanta su servidor y limpia al terminar.
// Ejecutar: node tests/run-tests.js

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const LOG = path.join(__dirname, 'resultados.txt');

const suites = [
  'tests/funcional/caja.test.js',
  'tests/funcional/ventas.test.js',
  'tests/funcional/servicio.test.js',
];

let fallos = 0;
let log = `run-tests.js — ${new Date().toISOString()}\n${'='.repeat(60)}\n`;

for (const suite of suites) {
  const cabecera = `\n--- ${suite} ---`;
  console.log(cabecera);
  log += cabecera + '\n';

  const resultado = spawnSync(
    process.execPath,
    ['--test', path.resolve(suite)],
    {
      encoding: 'utf8',
      env:      { ...process.env },
      timeout:  120_000,
    }
  );

  // Imprimir y registrar todo el output del subproceso
  const salida = (resultado.stdout || '') + (resultado.stderr || '');
  const lineas = salida.split('\n').filter(l =>
    !l.includes('injected env') &&
    !l.includes('Migraci') &&
    !l.includes('iniciado en http') &&
    l.trim()
  );
  lineas.forEach(l => { console.log(l); log += l + '\n'; });

  const resumen = resultado.status !== 0
    ? `FALLO en ${suite} (código ${resultado.status})`
    : `OK: ${suite}`;
  console.log(resumen);
  log += resumen + '\n';

  if (resultado.status !== 0) fallos++;
}

const conclusion = fallos === 0
  ? 'Todas las suites pasaron.'
  : `${fallos} suite(s) con fallos.`;

console.log('\n' + conclusion);
log += `\n${'='.repeat(60)}\n${conclusion}\n`;
fs.writeFileSync(LOG, log, 'utf8');

process.exit(fallos > 0 ? 1 : 0);
