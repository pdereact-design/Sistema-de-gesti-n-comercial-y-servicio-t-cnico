-- Migración 008: Campos adicionales para Servicio Técnico
--
-- repuestos_orden: variante_id permite vincular con inventario.
--   El descuento de stock usa consumirRepuesto(variante_id), no producto_id.
--
-- ordenes_servicio: campos de cobro para registrar el pago al entregar el equipo.
--   cobrado impide cobros duplicados.
--   metodo_pago y monto_efectivo replican el modelo de ventas para caja.

ALTER TABLE repuestos_orden
  ADD COLUMN IF NOT EXISTS variante_id INTEGER REFERENCES variantes_producto(id);

ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS cobrado       BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS metodo_pago   VARCHAR(30)
    CHECK (metodo_pago IN ('efectivo', 'tarjeta', 'transferencia', 'mixto')),
  ADD COLUMN IF NOT EXISTS monto_efectivo NUMERIC(10,2) DEFAULT 0;
