// Utilidades de validación compartidas entre controllers

// Convierte un valor a número finito no negativo.
// Retorna null si el valor es undefined o null (campo opcional no enviado).
// Lanza un error descriptivo si el valor es inválido.
const parsePrecio = (valor, nombre) => {
  if (valor === undefined || valor === null) return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new Error(`${nombre} debe ser un número válido.`);
  if (n < 0)               throw new Error(`${nombre} no puede ser negativo.`);
  return n;
};

// Igual que parsePrecio pero retorna un valor por defecto en lugar de null.
const parsePrecioConDefault = (valor, nombre, defecto = 0) => {
  const resultado = parsePrecio(valor, nombre);
  return resultado === null ? defecto : resultado;
};

// Convierte stock_minimo: entero no negativo, por defecto 1.
const parseStockMinimo = (valor) => {
  if (valor === undefined || valor === null) return 1;
  const n = Number(valor);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error('stock_minimo debe ser un número entero válido.');
  }
  if (n < 0) throw new Error('stock_minimo no puede ser negativo.');
  return n;
};

// Verifica que un valor sea una cadena no vacía antes de llamar trim().
const trimSafe = (valor) => {
  if (typeof valor !== 'string') return null;
  const t = valor.trim();
  return t.length > 0 ? t : null;
};

module.exports = { parsePrecioConDefault, parseStockMinimo, trimSafe };
