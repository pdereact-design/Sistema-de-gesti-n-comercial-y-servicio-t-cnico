-- Migración 003: Eliminación del rol cajero
--
-- Objetivo: dejar el sistema con cuatro roles únicamente:
--   admin, ventas, almacen, tecnico
--
-- Nota: esta migración no incluye BEGIN/COMMIT explícitos.
-- El runner migrate.js ya gestiona la transacción externamente.
-- Si cualquier paso falla, migrate.js ejecuta ROLLBACK automáticamente.
--
-- Tablas afectadas:
--   - roles      : se elimina el registro cajero
--   - usuarios   : los usuarios con cajero se reasignan a ventas
--
-- Tablas NO afectadas (solo referencian usuarios, no roles):
--   - sesiones_caja, movimientos_caja, ventas, detalle_ventas,
--     ordenes_servicio, movimientos_inventario

DO $$
DECLARE
  v_id_cajero  INTEGER;
  v_id_ventas  INTEGER;
  v_cantidad   INTEGER;
BEGIN

  -- Obtener los IDs de cajero y ventas
  SELECT id INTO v_id_cajero FROM roles WHERE nombre = 'cajero';
  SELECT id INTO v_id_ventas FROM roles WHERE nombre = 'ventas';

  -- Si cajero ya no existe, la migración ya fue aplicada
  IF v_id_cajero IS NULL THEN
    RAISE NOTICE 'El rol cajero no existe. Migración omitida.';
    RETURN;
  END IF;

  -- Si ventas no existe, las migraciones anteriores no se ejecutaron
  IF v_id_ventas IS NULL THEN
    RAISE EXCEPTION 'El rol ventas no existe. Ejecuta primero la migración 002.';
  END IF;

  -- Contar usuarios con rol cajero antes de migrar
  SELECT COUNT(*) INTO v_cantidad
  FROM usuarios
  WHERE rol_id = v_id_cajero;

  RAISE NOTICE 'Usuarios con rol cajero encontrados: %', v_cantidad;

  -- Reasignar al rol ventas todos los usuarios con cajero.
  -- Se actualiza updated_at para dejar trazabilidad del cambio.
  UPDATE usuarios
  SET rol_id     = v_id_ventas,
      updated_at = NOW()
  WHERE rol_id = v_id_cajero;

  RAISE NOTICE 'Usuarios reasignados al rol ventas: %', v_cantidad;

  -- Verificar que no quede ningún usuario referenciando cajero
  SELECT COUNT(*) INTO v_cantidad
  FROM usuarios
  WHERE rol_id = v_id_cajero;

  IF v_cantidad > 0 THEN
    RAISE EXCEPTION 'Aún existen % usuario(s) con el rol cajero. Abortando.', v_cantidad;
  END IF;

  -- Eliminar el rol cajero.
  -- En este punto ningún usuario lo referencia,
  -- por lo que la restricción de clave foránea no impide el DELETE.
  DELETE FROM roles WHERE id = v_id_cajero;

  RAISE NOTICE 'Rol cajero eliminado correctamente.';

END;
$$;
