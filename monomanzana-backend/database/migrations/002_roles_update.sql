-- Migración 002: Actualización de roles del sistema
-- Renombra 'vendedor' a 'ventas' y agrega el rol 'almacen'

-- Renombrar vendedor -> ventas si aún existe con el nombre anterior
UPDATE roles SET nombre = 'ventas', descripcion = 'Gestión de ventas y clientes'
WHERE nombre = 'vendedor';

-- Agregar rol almacen si no existe
INSERT INTO roles (nombre, descripcion)
VALUES ('almacen', 'Gestión de inventario y productos')
ON CONFLICT (nombre) DO NOTHING;
