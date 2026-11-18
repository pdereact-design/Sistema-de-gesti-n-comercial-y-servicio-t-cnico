const pool = require('../config/db');
const { parsePrecioConDefault, parseStockMinimo, trimSafe } = require('../utils/validators');

// Reglas por tipo:
//   iphone    → color, almacenamiento y condicion obligatorios
//   repuesto  → solo sku obligatorio; color, almacenamiento y condicion son nulos
//   accesorio → solo sku obligatorio; color opcional; almacenamiento y condicion son nulos
const validarCampos = (body, tipoproducto) => {
  const errores = [];
  const { sku, condicion, color, almacenamiento } = body;

  if (!trimSafe(sku)) errores.push('El SKU es obligatorio.');

  if (condicion && !['nuevo', 'seminuevo'].includes(condicion)) {
    errores.push('La condición debe ser nuevo o seminuevo.');
  }

  if (tipoproducto === 'iphone') {
    if (!trimSafe(color))          errores.push('El color es obligatorio para variantes de iPhone.');
    if (!trimSafe(almacenamiento)) errores.push('El almacenamiento es obligatorio para variantes de iPhone.');
    if (!condicion)                errores.push('La condición es obligatoria para variantes de iPhone.');
  }

  return errores;
};

// Obtiene el tipo del producto o devuelve null si no existe
const obtenerTipoProducto = async (productoId) => {
  const r = await pool.query('SELECT tipo FROM productos WHERE id = $1', [productoId]);
  return r.rows.length > 0 ? r.rows[0].tipo : null;
};

// Parsea y valida los campos numéricos; lanza Error con mensaje claro si son inválidos
const parsearNumericos = (body) => ({
  precio_compra: parsePrecioConDefault(body.precio_compra, 'precio_compra', 0),
  precio_venta:  parsePrecioConDefault(body.precio_venta,  'precio_venta',  0),
  stock_minimo:  parseStockMinimo(body.stock_minimo),
});

// GET /api/productos/:productoId/variantes
const getVariantes = async (req, res, next) => {
  try {
    const productoId = parseInt(req.params.productoId, 10);
    if (isNaN(productoId)) {
      return res.status(400).json({ success: false, message: 'El ID del producto debe ser un número.' });
    }

    const result = await pool.query(
      `SELECT id, sku, color, almacenamiento, condicion,
              precio_compra, precio_venta, stock_minimo, activo, created_at
       FROM variantes_producto
       WHERE producto_id = $1
       ORDER BY condicion, almacenamiento, color`,
      [productoId]
    );

    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/productos/:productoId/variantes/:id
const getVarianteById = async (req, res, next) => {
  try {
    const productoId = parseInt(req.params.productoId, 10);
    const id         = parseInt(req.params.id, 10);

    if (isNaN(productoId) || isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Los IDs deben ser números.' });
    }

    const result = await pool.query(
      `SELECT id, sku, color, almacenamiento, condicion,
              precio_compra, precio_venta, stock_minimo, activo, created_at, updated_at
       FROM variantes_producto
       WHERE id = $1 AND producto_id = $2`,
      [id, productoId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Variante no encontrada.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// POST /api/productos/:productoId/variantes
const createVariante = async (req, res, next) => {
  try {
    const productoId = parseInt(req.params.productoId, 10);
    if (isNaN(productoId)) {
      return res.status(400).json({ success: false, message: 'El ID del producto debe ser un número.' });
    }

    const tipoproducto = await obtenerTipoProducto(productoId);
    if (!tipoproducto) {
      return res.status(404).json({ success: false, message: 'Producto no encontrado.' });
    }

    const errores = validarCampos(req.body, tipoproducto);
    if (errores.length > 0) {
      return res.status(400).json({ success: false, message: errores.join(' ') });
    }

    let numericos;
    try {
      numericos = parsearNumericos(req.body);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    const sku            = trimSafe(req.body.sku);
    const color          = trimSafe(req.body.color);
    const almacenamiento = trimSafe(req.body.almacenamiento);
    const condicion      = req.body.condicion || null;

    const dup = await pool.query(
      'SELECT id FROM variantes_producto WHERE sku = $1',
      [sku]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Ya existe una variante con ese SKU.' });
    }

    const result = await pool.query(
      `INSERT INTO variantes_producto
         (producto_id, sku, color, almacenamiento, condicion,
          precio_compra, precio_venta, stock_minimo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, sku, color, almacenamiento, condicion,
                 precio_compra, precio_venta, stock_minimo, activo, created_at`,
      [
        productoId, sku,
        // color: obligatorio en iPhones, opcional en accesorios, nulo en repuestos
        tipoproducto === 'repuesto' ? null : color,
        // almacenamiento y condicion: solo iPhones
        tipoproducto === 'iphone' ? almacenamiento : null,
        tipoproducto === 'iphone' ? condicion      : null,
        numericos.precio_compra,
        numericos.precio_venta,
        numericos.stock_minimo,
      ]
    );

    res.status(201).json({
      success: true,
      data:    result.rows[0],
      message: 'Variante registrada correctamente.',
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'uq_variante') {
      return res.status(409).json({
        success: false,
        message: 'Ya existe una variante con esa combinación de color, almacenamiento y condición.',
      });
    }
    next(err);
  }
};

// PUT /api/productos/:productoId/variantes/:id
const updateVariante = async (req, res, next) => {
  try {
    const productoId = parseInt(req.params.productoId, 10);
    const id         = parseInt(req.params.id, 10);

    if (isNaN(productoId) || isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Los IDs deben ser números.' });
    }

    const tipoproducto = await obtenerTipoProducto(productoId);
    if (!tipoproducto) {
      return res.status(404).json({ success: false, message: 'Producto no encontrado.' });
    }

    const errores = validarCampos(req.body, tipoproducto);
    if (errores.length > 0) {
      return res.status(400).json({ success: false, message: errores.join(' ') });
    }

    let numericos;
    try {
      numericos = parsearNumericos(req.body);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    const sku            = trimSafe(req.body.sku);
    const color          = trimSafe(req.body.color);
    const almacenamiento = trimSafe(req.body.almacenamiento);
    const condicion      = req.body.condicion || null;

    const dup = await pool.query(
      'SELECT id FROM variantes_producto WHERE sku = $1 AND id <> $2',
      [sku, id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Ya existe otra variante con ese SKU.' });
    }

    const result = await pool.query(
      `UPDATE variantes_producto SET
         sku=$1, color=$2, almacenamiento=$3, condicion=$4,
         precio_compra=$5, precio_venta=$6, stock_minimo=$7, updated_at=NOW()
       WHERE id=$8 AND producto_id=$9
       RETURNING id, sku, color, almacenamiento, condicion,
                 precio_compra, precio_venta, stock_minimo, activo, updated_at`,
      [
        sku,
        // color: obligatorio en iphone, opcional en accesorio, nulo en repuesto
        tipoproducto === 'repuesto' ? null : color,
        // almacenamiento y condicion: solo iphone
        tipoproducto === 'iphone' ? almacenamiento : null,
        tipoproducto === 'iphone' ? condicion      : null,
        numericos.precio_compra,
        numericos.precio_venta,
        numericos.stock_minimo,
        id, productoId,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Variante no encontrada.' });
    }

    res.json({ success: true, data: result.rows[0], message: 'Variante actualizada correctamente.' });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'uq_variante') {
      return res.status(409).json({
        success: false,
        message: 'Ya existe una variante con esa combinación de color, almacenamiento y condición.',
      });
    }
    next(err);
  }
};

// PATCH /api/productos/:productoId/variantes/:id/estado
const toggleEstadoVariante = async (req, res, next) => {
  try {
    const productoId = parseInt(req.params.productoId, 10);
    const id         = parseInt(req.params.id, 10);

    if (isNaN(productoId) || isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Los IDs deben ser números.' });
    }

    const { activo } = req.body;
    if (typeof activo !== 'boolean') {
      return res.status(400).json({ success: false, message: 'El campo activo debe ser true o false.' });
    }

    const result = await pool.query(
      `UPDATE variantes_producto SET activo=$1, updated_at=NOW()
       WHERE id=$2 AND producto_id=$3
       RETURNING id, sku, activo`,
      [activo, id, productoId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Variante no encontrada.' });
    }

    const estado = activo ? 'activada' : 'desactivada';
    res.json({ success: true, data: result.rows[0], message: `Variante ${estado} correctamente.` });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getVariantes, getVarianteById,
  createVariante, updateVariante, toggleEstadoVariante,
};
