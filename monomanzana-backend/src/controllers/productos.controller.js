const pool = require('../config/db');
const { parsePrecioConDefault, parseStockMinimo, trimSafe } = require('../utils/validators');

// Tipos válidos de producto y sus reglas de validación
const TIPOS_VALIDOS = ['iphone', 'repuesto', 'accesorio'];

// Validar campos obligatorios según tipo de producto.
//   iphone   → marca y modelo obligatorios
//   repuesto → marca y modelos compatibles opcionales
//   accesorio→ marca obligatoria
// Retorna un array de mensajes de error; vacío si todo es válido.
const validarCampos = (body) => {
  const { nombre, codigo, categoria_id, tipo, marca, modelo_iphone_id } = body;
  const errores = [];

  if (!trimSafe(nombre))    errores.push('El nombre es obligatorio.');
  if (!trimSafe(codigo))    errores.push('El código SKU es obligatorio.');
  if (!categoria_id)        errores.push('La categoría es obligatoria.');

  if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
    errores.push(`El tipo es obligatorio y debe ser: ${TIPOS_VALIDOS.join(', ')}.`);
  }

  // Marca obligatoria para iphone y accesorio; opcional para repuesto
  if (tipo !== 'repuesto' && !trimSafe(marca)) {
    errores.push('La marca es obligatoria.');
  }

  // Solo los iPhones requieren modelo
  if (tipo === 'iphone' && !modelo_iphone_id) {
    errores.push('El modelo de iPhone es obligatorio para productos de tipo iphone.');
  }

  return errores;
};

// GET /api/productos?buscar=&categoria_id=&tipo=&activo=
const getProductos = async (req, res, next) => {
  try {
    const { buscar, categoria_id, tipo, activo } = req.query;
    const params = [];
    const condiciones = [];
    let idx = 1;

    if (trimSafe(buscar)) {
      params.push(`%${buscar.trim()}%`);
      condiciones.push(`(p.nombre ILIKE $${idx} OR p.codigo ILIKE $${idx})`);
      idx++;
    }

    if (categoria_id) {
      params.push(parseInt(categoria_id, 10));
      condiciones.push(`p.categoria_id = $${idx}`);
      idx++;
    }

    if (tipo && TIPOS_VALIDOS.includes(tipo)) {
      params.push(tipo);
      condiciones.push(`p.tipo = $${idx}`);
      idx++;
    }

    if (activo !== undefined) {
      params.push(activo === 'true');
      condiciones.push(`p.activo = $${idx}`);
      idx++;
    }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT p.id, p.codigo, p.nombre, p.tipo, p.marca, p.descripcion,
              p.activo, p.categoria_id, c.nombre AS categoria,
              p.modelo_iphone_id, m.nombre AS modelo_iphone,
              p.created_at
       FROM productos p
       LEFT JOIN categorias c     ON p.categoria_id     = c.id
       LEFT JOIN modelos_iphone m ON p.modelo_iphone_id = m.id
       ${where}
       ORDER BY p.tipo ASC, p.nombre ASC`,
      params
    );

    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/productos/:id — incluye variantes
const getProductoById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const prod = await pool.query(
      `SELECT p.id, p.codigo, p.nombre, p.tipo, p.marca, p.descripcion,
              p.activo, p.stock_minimo,
              p.categoria_id,     c.nombre AS categoria,
              p.modelo_iphone_id, m.nombre AS modelo_iphone,
              p.modelos_compatibles, p.created_at, p.updated_at
       FROM productos p
       LEFT JOIN categorias c     ON p.categoria_id     = c.id
       LEFT JOIN modelos_iphone m ON p.modelo_iphone_id = m.id
       WHERE p.id = $1`,
      [id]
    );

    if (prod.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Producto no encontrado.' });
    }

    // Variantes: fuente de verdad para precios y atributos comerciales
    const variantes = await pool.query(
      `SELECT id, sku, color, almacenamiento, condicion,
              precio_compra, precio_venta, stock_minimo, activo
       FROM variantes_producto
       WHERE producto_id = $1
       ORDER BY condicion, almacenamiento, color`,
      [id]
    );

    res.json({ success: true, data: { ...prod.rows[0], variantes: variantes.rows } });
  } catch (err) {
    next(err);
  }
};

// POST /api/productos
const createProducto = async (req, res, next) => {
  try {
    const errores = validarCampos(req.body);
    if (errores.length > 0) {
      return res.status(400).json({ success: false, message: errores.join(' ') });
    }

    const { codigo, nombre, tipo, descripcion, categoria_id,
            modelo_iphone_id, marca, modelos_compatibles } = req.body;

    // stock_minimo en productos se conserva por compatibilidad pero
    // los precios comerciales viven en variantes_producto.
    let stock_minimo;
    try {
      stock_minimo = parseStockMinimo(req.body.stock_minimo);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    const dup = await pool.query(
      'SELECT id FROM productos WHERE codigo = $1',
      [codigo.trim()]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Ya existe un producto con ese código SKU.' });
    }

    const result = await pool.query(
      `INSERT INTO productos
         (codigo, nombre, tipo, descripcion, categoria_id,
          modelo_iphone_id, marca, stock_minimo, modelos_compatibles)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, codigo, nombre, tipo, marca, descripcion,
                 stock_minimo, activo, created_at`,
      [
        codigo.trim(),
        nombre.trim(),
        tipo,
        trimSafe(descripcion),
        categoria_id,
        tipo === 'iphone' ? (modelo_iphone_id || null) : null,
        trimSafe(marca),
        stock_minimo,
        trimSafe(modelos_compatibles),
      ]
    );

    res.status(201).json({
      success: true,
      data:    result.rows[0],
      message: 'Producto registrado correctamente.',
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/productos/:id
const updateProducto = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const errores = validarCampos(req.body);
    if (errores.length > 0) {
      return res.status(400).json({ success: false, message: errores.join(' ') });
    }

    const { codigo, nombre, tipo, descripcion, categoria_id,
            modelo_iphone_id, marca, modelos_compatibles } = req.body;

    let stock_minimo;
    try {
      stock_minimo = parseStockMinimo(req.body.stock_minimo);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    const dup = await pool.query(
      'SELECT id FROM productos WHERE codigo = $1 AND id <> $2',
      [codigo.trim(), id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Ya existe otro producto con ese código SKU.' });
    }

    const result = await pool.query(
      `UPDATE productos SET
         codigo=$1, nombre=$2, tipo=$3, descripcion=$4, categoria_id=$5,
         modelo_iphone_id=$6, marca=$7, stock_minimo=$8,
         modelos_compatibles=$9, updated_at=NOW()
       WHERE id=$10
       RETURNING id, codigo, nombre, tipo, marca, stock_minimo, activo, updated_at`,
      [
        codigo.trim(), nombre.trim(), tipo,
        trimSafe(descripcion), categoria_id,
        tipo === 'iphone' ? (modelo_iphone_id || null) : null,
        trimSafe(marca), stock_minimo,
        trimSafe(modelos_compatibles),
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Producto no encontrado.' });
    }

    res.json({ success: true, data: result.rows[0], message: 'Producto actualizado correctamente.' });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/productos/:id/estado
const toggleEstadoProducto = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const { activo } = req.body;
    if (typeof activo !== 'boolean') {
      return res.status(400).json({ success: false, message: 'El campo activo debe ser true o false.' });
    }

    const result = await pool.query(
      'UPDATE productos SET activo=$1, updated_at=NOW() WHERE id=$2 RETURNING id, nombre, tipo, activo',
      [activo, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Producto no encontrado.' });
    }

    const estado = activo ? 'activado' : 'desactivado';
    res.json({ success: true, data: result.rows[0], message: `Producto ${estado} correctamente.` });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProductos, getProductoById,
  createProducto, updateProducto, toggleEstadoProducto,
};
