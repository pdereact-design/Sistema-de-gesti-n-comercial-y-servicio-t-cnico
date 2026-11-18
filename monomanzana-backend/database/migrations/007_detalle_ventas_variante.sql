-- Migración 007: Ampliar detalle_ventas y ventas para soporte de variantes y pagos mixtos

-- variante_id: identifica qué combinación comercial se vendió
-- unidad_fisica_id: identifica el iPhone físico vendido (solo iPhones)
ALTER TABLE detalle_ventas
  ADD COLUMN IF NOT EXISTS variante_id      INTEGER REFERENCES variantes_producto(id),
  ADD COLUMN IF NOT EXISTS unidad_fisica_id INTEGER REFERENCES unidades_fisicas(id);

-- monto_efectivo: importe recibido en efectivo en pagos mixtos.
-- Para efectivo puro es igual al total. Para tarjeta/transferencia es 0.
-- Para mixto es el monto parcial en efectivo que se registra en caja.
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS monto_efectivo
NUMERIC(10,2) NOT NULL DEFAULT 0
CHECK (monto_efectivo >= 0);
