const pool = require('../config/db');

// GET /api/categorias?activo=true
const getCategorias = async (req, res, next) => {
  try {
    const { activo } = req.query;
    const params = [];
    let where = '';

    if (activo !== undefined) {
      params.push(activo === 'true');
      where = 'WHERE activo = $1';
    }

    const result = await pool.query(
      `SELECT id, nombre, descripcion, activo, created_at
       FROM categorias ${where}
       ORDER BY nombre ASC`,
      params
    );

    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/categorias/:id
const getCategoriaById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const result = await pool.query(
      'SELECT id, nombre, descripcion, activo, created_at FROM categorias WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Categoría no encontrada.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// POST /api/categorias
const createCategoria = async (req, res, next) => {
  try {
    const { nombre, descripcion } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ success: false, message: 'El nombre es obligatorio.' });
    }

    const dup = await pool.query(
      'SELECT id FROM categorias WHERE LOWER(nombre) = LOWER($1)',
      [nombre.trim()]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Ya existe una categoría con ese nombre.' });
    }

    const result = await pool.query(
      `INSERT INTO categorias (nombre, descripcion)
       VALUES ($1, $2)
       RETURNING id, nombre, descripcion, activo, created_at`,
      [nombre.trim(), descripcion?.trim() || null]
    );

    res.status(201).json({ success: true, data: result.rows[0], message: 'Categoría registrada correctamente.' });
  } catch (err) {
    next(err);
  }
};

// PUT /api/categorias/:id
const updateCategoria = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const { nombre, descripcion } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ success: false, message: 'El nombre es obligatorio.' });
    }

    const dup = await pool.query(
      'SELECT id FROM categorias WHERE LOWER(nombre) = LOWER($1) AND id <> $2',
      [nombre.trim(), id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Ya existe otra categoría con ese nombre.' });
    }

    const result = await pool.query(
      `UPDATE categorias SET nombre = $1, descripcion = $2
       WHERE id = $3
       RETURNING id, nombre, descripcion, activo`,
      [nombre.trim(), descripcion?.trim() || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Categoría no encontrada.' });
    }

    res.json({ success: true, data: result.rows[0], message: 'Categoría actualizada correctamente.' });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/categorias/:id/estado
const toggleEstadoCategoria = async (req, res, next) => {
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
      'UPDATE categorias SET activo = $1 WHERE id = $2 RETURNING id, nombre, activo',
      [activo, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Categoría no encontrada.' });
    }

    const estado = activo ? 'activada' : 'desactivada';
    res.json({ success: true, data: result.rows[0], message: `Categoría ${estado} correctamente.` });
  } catch (err) {
    next(err);
  }
};

module.exports = { getCategorias, getCategoriaById, createCategoria, updateCategoria, toggleEstadoCategoria };
