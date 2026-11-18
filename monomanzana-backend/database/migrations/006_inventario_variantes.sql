-- Migración 006: Adaptar inventario y movimientos para variantes
--
-- No se asignan registros existentes automáticamente.
-- No se eliminan datos ni historial.

-- =============================================
-- Paso 1: Agregar columnas
-- =============================================
ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS variante_id INTEGER REFERENCES variantes_producto(id);

ALTER TABLE movimientos_inventario
  ADD COLUMN IF NOT EXISTS variante_id      INTEGER REFERENCES variantes_producto(id),
  ADD COLUMN IF NOT EXISTS unidad_fisica_id INTEGER REFERENCES unidades_fisicas(id);

-- =============================================
-- Paso 2: Claves únicas para FK compuestas
-- =============================================

-- Permite validar que variante_id y producto_id correspondan a la misma variante
ALTER TABLE variantes_producto
  ADD CONSTRAINT uq_variante_producto UNIQUE (id, producto_id);

-- Permite validar que unidad_fisica_id y variante_id correspondan a la misma unidad
ALTER TABLE unidades_fisicas
  ADD CONSTRAINT uq_unidad_variante UNIQUE (id, variante_id);

-- =============================================
-- Paso 3: FK compuestas
-- =============================================

-- inventario: variante_id + producto_id deben pertenecer a la misma variante
ALTER TABLE inventario
  ADD CONSTRAINT fk_inventario_variante_producto
  FOREIGN KEY (variante_id, producto_id)
  REFERENCES variantes_producto(id, producto_id);

-- movimientos: variante_id + producto_id deben pertenecer a la misma variante
ALTER TABLE movimientos_inventario
  ADD CONSTRAINT fk_movimiento_variante_producto
  FOREIGN KEY (variante_id, producto_id)
  REFERENCES variantes_producto(id, producto_id);

-- movimientos: unidad_fisica_id + variante_id deben pertenecer a la misma unidad
ALTER TABLE movimientos_inventario
  ADD CONSTRAINT fk_movimiento_unidad_variante
  FOREIGN KEY (unidad_fisica_id, variante_id)
  REFERENCES unidades_fisicas(id, variante_id);

-- =============================================
-- Paso 4: Restricciones UNIQUE
-- =============================================

ALTER TABLE inventario DROP CONSTRAINT IF EXISTS inventario_producto_id_key;

ALTER TABLE inventario
  ADD CONSTRAINT uq_inventario_variante UNIQUE (variante_id);

-- =============================================
-- Paso 5: CHECK de cantidad en movimientos
-- =============================================
ALTER TABLE movimientos_inventario
  ADD CONSTRAINT chk_cantidad_movimiento CHECK (
    (tipo = 'entrada' AND cantidad > 0) OR
    (tipo = 'salida'  AND cantidad > 0) OR
    (tipo = 'ajuste'  AND cantidad <> 0)
  );

-- =============================================
-- Paso 6: Trigger — integridad de inventario
-- =============================================
-- Garantiza producto_id coincida con la variante
-- Impide iPhones en inventario (con o sin variante_id)
-- Conserva registros históricos: no bloquea UPDATE de registros existentes
-- sin variante_id, salvo que intenten asignarles variante de iPhone
CREATE OR REPLACE FUNCTION fn_inventario_integridad_variante()
RETURNS TRIGGER AS $$
DECLARE
  v_producto_id INTEGER;
  v_tipo        VARCHAR(20);
BEGIN
  IF NEW.variante_id IS NOT NULL THEN
    -- Variante asignada: validar correspondencia y tipo
    SELECT p.id, p.tipo INTO v_producto_id, v_tipo
    FROM variantes_producto v
    JOIN productos p ON v.producto_id = p.id
    WHERE v.id = NEW.variante_id;

    IF v_producto_id IS NULL THEN
      RAISE EXCEPTION 'La variante % no existe', NEW.variante_id;
    END IF;

    IF NEW.producto_id IS NULL THEN
      NEW.producto_id := v_producto_id;
    ELSIF NEW.producto_id <> v_producto_id THEN
      RAISE EXCEPTION
        'producto_id (%) no coincide con el producto de la variante (%)',
        NEW.producto_id, v_producto_id;
    END IF;

    IF v_tipo = 'iphone' THEN
      RAISE EXCEPTION
        'Las variantes de iPhone no pueden tener registros en inventario. El stock se controla mediante unidades_fisicas.';
    END IF;

  ELSIF TG_OP = 'INSERT' AND NEW.producto_id IS NOT NULL THEN
    -- Registro nuevo sin variante: verificar que no sea iPhone
    SELECT tipo INTO v_tipo FROM productos WHERE id = NEW.producto_id;

    IF v_tipo = 'iphone' THEN
      RAISE EXCEPTION
        'No se pueden crear registros de inventario para productos de tipo iPhone. El stock se controla mediante unidades_fisicas.';
    END IF;

  ELSIF TG_OP = 'UPDATE' AND OLD.variante_id IS NULL AND NEW.variante_id IS NULL THEN
    -- UPDATE de registro histórico sin variante: solo bloquear si el producto es iPhone
    -- y el producto_id está cambiando a un iPhone
    IF NEW.producto_id IS NOT NULL THEN
      SELECT tipo INTO v_tipo FROM productos WHERE id = NEW.producto_id;

      IF v_tipo = 'iphone' THEN
        RAISE EXCEPTION
          'No se pueden crear ni modificar registros de inventario para productos de tipo iPhone. El stock se controla mediante unidades_fisicas.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventario_integridad ON inventario;
CREATE TRIGGER trg_inventario_integridad
  BEFORE INSERT OR UPDATE ON inventario
  FOR EACH ROW EXECUTE FUNCTION fn_inventario_integridad_variante();

-- =============================================
-- Paso 7: Trigger — integridad de movimientos
-- =============================================
-- Valida correspondencia producto-variante
-- Valida que movimientos de iPhone tengan unidad_fisica_id y cantidad = 1
-- Valida que movimientos de repuestos/accesorios no tengan unidad_fisica_id
CREATE OR REPLACE FUNCTION fn_movimiento_integridad_variante()
RETURNS TRIGGER AS $$
DECLARE
  v_producto_id INTEGER;
  v_tipo         VARCHAR(20);
BEGIN
  IF NEW.variante_id IS NOT NULL THEN
    SELECT p.id, p.tipo INTO v_producto_id, v_tipo
    FROM variantes_producto v
    JOIN productos p ON v.producto_id = p.id
    WHERE v.id = NEW.variante_id;

    IF v_producto_id IS NULL THEN
      RAISE EXCEPTION 'La variante % no existe', NEW.variante_id;
    END IF;

    IF NEW.producto_id IS NULL THEN
      NEW.producto_id := v_producto_id;
    ELSIF NEW.producto_id <> v_producto_id THEN
      RAISE EXCEPTION
        'producto_id (%) no coincide con el producto de la variante (%)',
        NEW.producto_id, v_producto_id;
    END IF;

    -- Movimientos de iPhone: unidad_fisica_id obligatorio y cantidad = 1
    IF v_tipo = 'iphone' THEN
      IF NEW.unidad_fisica_id IS NULL THEN
        RAISE EXCEPTION
          'Los movimientos de iPhone deben tener unidad_fisica_id asignado.';
      END IF;
      IF NEW.cantidad <> 1 THEN
        RAISE EXCEPTION
          'Los movimientos de iPhone deben tener cantidad = 1 (una unidad por movimiento).';
      END IF;
    END IF;

    -- Movimientos de repuestos y accesorios: no deben tener unidad_fisica_id
    IF v_tipo IN ('repuesto', 'accesorio') AND NEW.unidad_fisica_id IS NOT NULL THEN
      RAISE EXCEPTION
        'Los movimientos de repuestos y accesorios no deben asociar unidades fisicas.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_movimiento_integridad ON movimientos_inventario;
CREATE TRIGGER trg_movimiento_integridad
  BEFORE INSERT OR UPDATE ON movimientos_inventario
  FOR EACH ROW EXECUTE FUNCTION fn_movimiento_integridad_variante();

-- =============================================
-- Paso 8: Trigger — unidades_fisicas solo para iPhones
-- =============================================
CREATE OR REPLACE FUNCTION fn_unidades_solo_iphone()
RETURNS TRIGGER AS $$
DECLARE
  v_tipo VARCHAR(20);
BEGIN
  SELECT p.tipo INTO v_tipo
  FROM variantes_producto v
  JOIN productos p ON v.producto_id = p.id
  WHERE v.id = NEW.variante_id;

  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'La variante % no existe', NEW.variante_id;
  END IF;

  IF v_tipo <> 'iphone' THEN
    RAISE EXCEPTION
      'Solo las variantes de iPhone pueden tener unidades fisicas. El producto es de tipo %.', v_tipo;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_unidades_solo_iphone ON unidades_fisicas;
CREATE TRIGGER trg_unidades_solo_iphone
  BEFORE INSERT OR UPDATE ON unidades_fisicas
  FOR EACH ROW EXECUTE FUNCTION fn_unidades_solo_iphone();

-- =============================================
-- Paso 9: Trigger — transiciones de estado válidas
-- =============================================
CREATE OR REPLACE FUNCTION fn_transicion_estado_unidad()
RETURNS TRIGGER AS $$
BEGIN
  -- Si el estado no cambia, permitir la actualización sin validar transición
  IF NEW.estado = OLD.estado THEN
    RETURN NEW;
  END IF;

  -- Estados terminales no pueden cambiar de estado
  IF OLD.estado IN ('vendido', 'dado_de_baja') THEN
    RAISE EXCEPTION
      'La unidad % está en estado terminal (%) y no puede cambiar de estado.',
      OLD.id, OLD.estado;
  END IF;

  -- Transiciones permitidas:
  --   disponible  → vendido, en_servicio, dado_de_baja
  --   en_servicio → disponible, dado_de_baja
  IF NOT (
    (OLD.estado = 'disponible'  AND NEW.estado IN ('vendido', 'en_servicio', 'dado_de_baja')) OR
    (OLD.estado = 'en_servicio' AND NEW.estado IN ('disponible', 'dado_de_baja'))
  ) THEN
    RAISE EXCEPTION 'Transicion no permitida: % → %', OLD.estado, NEW.estado;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transicion_estado_unidad ON unidades_fisicas;
CREATE TRIGGER trg_transicion_estado_unidad
  BEFORE UPDATE ON unidades_fisicas
  FOR EACH ROW EXECUTE FUNCTION fn_transicion_estado_unidad();
