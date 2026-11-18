const pool = require('../config/db');

// GET /api/modelos?activo=true
const getModelos = async (req, res, next) => {
  try {
    const { activo } = req.query;
    const params = [];
    let where = '';

    if (activo !== undefined) {
      params.push(activo === 'true');
      where = 'WHERE activo = $1';
    }

    const result = await pool.query(
      `SELECT id, nombre, anio, activo FROM modelos_iphone ${where} ORDER BY anio DESC, nombre ASC`,
      params
    );

    res.json({ success: true, total: result.rows.length, data: result.rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/modelos/:id
const getModeloById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const result = await pool.query(
      'SELECT id, nombre, anio, activo FROM modelos_iphone WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Modelo no encontrado.' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
};

// POST /api/modelos
const createModelo = async (req, res, next) => {
  try {
    const { nombre, anio } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ success: false, message: 'El nombre del modelo es obligatorio.' });
    }

    if (anio && (isNaN(anio) || anio < 2007 || anio > new Date().getFullYear() + 1)) {
      return res.status(400).json({ success: false, message: 'El año del modelo no es válido.' });
    }

    const dup = await pool.query(
      'SELECT id FROM modelos_iphone WHERE LOWER(nombre) = LOWER($1)',
      [nombre.trim()]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Ya existe un modelo con ese nombre.' });
    }

    const result = await pool.query(
      'INSERT INTO modelos_iphone (nombre, anio) VALUES ($1, $2) RETURNING id, nombre, anio, activo',
      [nombre.trim(), anio || null]
    );

    res.status(201).json({ success: true, data: result.rows[0], message: 'Modelo registrado correctamente.' });
  } catch (err) {
    next(err);
  }
};

// PUT /api/modelos/:id
const updateModelo = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'El ID debe ser un número.' });
    }

    const { nombre, anio } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ success: false, message: 'El nombre del modelo es obligatorio.' });
    }

    const dup = await pool.query(
      'SELECT id FROM modelos_iphone WHERE LOWER(nombre) = LOWER($1) AND id <> $2',
      [nombre.trim(), id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Ya existe otro modelo con ese nombre.' });
    }

    const result = await pool.query(
      'UPDATE modelos_iphone SET nombre = $1, anio = $2 WHERE id = $3 RETURNING id, nombre, anio, activo',
      [nombre.trim(), anio || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Modelo no encontrado.' });
    }

    res.json({ success: true, data: result.rows[0], message: 'Modelo actualizado correctamente.' });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/modelos/:id/estado
const toggleEstadoModelo = async (req, res, next) => {
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
      'UPDATE modelos_iphone SET activo = $1 WHERE id = $2 RETURNING id, nombre, anio, activo',
      [activo, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Modelo no encontrado.' });
    }

    const estado = activo ? 'activado' : 'desactivado';
    res.json({ success: true, data: result.rows[0], message: `Modelo ${estado} correctamente.` });
  } catch (err) {
    next(err);
  }
};

module.exports = { getModelos, getModeloById, createModelo, updateModelo, toggleEstadoModelo };
