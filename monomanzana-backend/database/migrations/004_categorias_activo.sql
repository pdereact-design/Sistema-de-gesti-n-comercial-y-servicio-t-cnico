-- Migración 004: Agrega columna activo a categorias
-- Permite desactivar categorías sin eliminarlas ni afectar productos existentes.
-- Todos los registros existentes quedan con activo = true por el DEFAULT.

ALTER TABLE categorias ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE;
