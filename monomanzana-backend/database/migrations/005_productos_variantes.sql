-- Migración 005: Nuevas columnas en productos, tabla variantes_producto y unidades_fisicas
--
-- Separación de responsabilidades:
--   productos          → catálogo base (tipo, nombre, categoría, modelo, marca)
--   variantes_producto → precios y atributos comerciales (color, almacenamiento, condicion)
--   unidades_fisicas   → unidades individuales con IMEI o número de serie
--
-- Esta migración no modifica la tabla inventario existente.

-- Paso 1: Agregar columnas nuevas en productos como nullable primero.
-- tipo  : distingue iphone de accesorio. Se agrega nullable para no romper registros existentes.
-- marca : fabricante del producto.
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS tipo  VARCHAR(20) CHECK (tipo IN ('iphone', 'repuesto', 'accesorio')),
  ADD COLUMN IF NOT EXISTS marca VARCHAR(100);

-- Paso 2: Asignar un valor a los registros existentes que tengan tipo NULL.
-- Los registros con modelo_iphone_id asignado se marcan como iphone.
-- El resto se trata como accesorio por defecto.
UPDATE productos SET tipo = 'iphone'    WHERE tipo IS NULL AND modelo_iphone_id IS NOT NULL;
UPDATE productos SET tipo = 'accesorio' WHERE tipo IS NULL;

-- Paso 3: Aplicar NOT NULL una vez que todos los registros tienen valor.
ALTER TABLE productos ALTER COLUMN tipo SET NOT NULL;

-- Tabla de variantes comerciales.
-- Fuente de verdad para precios, stock mínimo, color, almacenamiento y condicion.
-- Los iPhones requieren color, almacenamiento y condicion.
-- Los accesorios solo requieren sku; color es opcional.
CREATE TABLE IF NOT EXISTS variantes_producto (
  id             SERIAL PRIMARY KEY,

  producto_id    INTEGER NOT NULL REFERENCES productos(id),
  sku            VARCHAR(50) UNIQUE NOT NULL,

  color          VARCHAR(50),
  almacenamiento VARCHAR(20),    -- Solo iPhones: 128GB, 256GB, 512GB, 1TB
  condicion      VARCHAR(20)     CHECK (condicion IN ('nuevo', 'seminuevo')),

  precio_compra  DECIMAL(10,2) NOT NULL DEFAULT 0  CHECK (precio_compra >= 0),
  precio_venta   DECIMAL(10,2) NOT NULL DEFAULT 0  CHECK (precio_venta  >= 0),
  stock_minimo   INTEGER       NOT NULL DEFAULT 1  CHECK (stock_minimo  >= 0),

  activo         BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW(),

  -- Evita duplicados incluso cuando color, almacenamiento o condicion son NULL.
  -- Requiere PostgreSQL 15 o superior (compatible con PostgreSQL 18).
  CONSTRAINT uq_variante UNIQUE NULLS NOT DISTINCT (producto_id, color, almacenamiento, condicion)
);

-- Tabla de unidades físicas individuales de iPhone.
-- Cada fila representa un equipo real identificado por IMEI o número de serie.
CREATE TABLE IF NOT EXISTS unidades_fisicas (
  id                 SERIAL PRIMARY KEY,

  variante_id        INTEGER NOT NULL REFERENCES variantes_producto(id),

  tipo_identificador VARCHAR(10) NOT NULL
                     CHECK (tipo_identificador IN ('imei', 'serie')),

  -- UNIQUE garantiza que no se registre el mismo equipo dos veces.
  identificador      VARCHAR(30) NOT NULL,

  estado             VARCHAR(20) NOT NULL DEFAULT 'disponible'
                     CHECK (estado IN ('disponible', 'vendido', 'en_servicio', 'dado_de_baja')),

  -- Precio de compra específico de esta unidad física.
  precio_compra      DECIMAL(10,2) CHECK (precio_compra IS NULL OR precio_compra >= 0),

  created_at         TIMESTAMP DEFAULT NOW(),
  updated_at         TIMESTAMP DEFAULT NOW(),

  CONSTRAINT uq_identificador UNIQUE (identificador)
);
