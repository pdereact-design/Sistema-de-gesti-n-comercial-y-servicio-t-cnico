-- =============================================
-- MonoManzana - Schema de Base de Datos
-- Tienda especializada en iPhones, repuestos y accesorios
-- PostgreSQL
-- =============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- USUARIOS Y ROLES
-- =============================================
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(50) UNIQUE NOT NULL, -- admin, vendedor, tecnico, cajero
  descripcion TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  apellido VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  rol_id INTEGER REFERENCES roles(id),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- =============================================
-- CATÁLOGO DE PRODUCTOS
-- (Solo iPhones, repuestos y accesorios)
-- =============================================
CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) UNIQUE NOT NULL,
  descripcion TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
-- Categorías: iPhone, Repuesto, Accesorio

CREATE TABLE IF NOT EXISTS modelos_iphone (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) UNIQUE NOT NULL, -- iPhone 13, iPhone 14 Pro, etc.
  anio INTEGER,
  activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS productos (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(50) UNIQUE NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  descripcion TEXT,
  categoria_id INTEGER REFERENCES categorias(id),
  -- Para iPhones: modelo, almacenamiento, color
  modelo_iphone_id INTEGER REFERENCES modelos_iphone(id),
  almacenamiento VARCHAR(20),   -- 128GB, 256GB, 512GB, 1TB (solo para iPhones)
  color VARCHAR(50),            -- Negro, Blanco, Azul, etc.
  -- Para repuestos: a qué modelos aplica
  modelos_compatibles TEXT,     -- JSON array: ["iPhone 13","iPhone 14"]
  precio_compra DECIMAL(10,2) NOT NULL DEFAULT 0,
  precio_venta DECIMAL(10,2) NOT NULL DEFAULT 0,
  stock_minimo INTEGER DEFAULT 1,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- =============================================
-- INVENTARIO
-- =============================================
CREATE TABLE IF NOT EXISTS inventario (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER REFERENCES productos(id) UNIQUE,
  cantidad INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER REFERENCES productos(id),
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('entrada', 'salida', 'ajuste')),
  cantidad INTEGER NOT NULL,
  motivo TEXT,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- =============================================
-- CLIENTES
-- =============================================
CREATE TABLE IF NOT EXISTS clientes (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  apellido VARCHAR(100) NOT NULL,
  cedula VARCHAR(20) UNIQUE,
  email VARCHAR(150),
  telefono VARCHAR(20),
  direccion TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- =============================================
-- VENTAS
-- =============================================
CREATE TABLE IF NOT EXISTS ventas (
  id SERIAL PRIMARY KEY,
  numero_factura VARCHAR(50) UNIQUE NOT NULL,
  cliente_id INTEGER REFERENCES clientes(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  descuento DECIMAL(10,2) DEFAULT 0,
  impuesto DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  metodo_pago VARCHAR(30) CHECK (metodo_pago IN ('efectivo', 'tarjeta', 'transferencia', 'mixto')),
  estado VARCHAR(20) DEFAULT 'completada' CHECK (estado IN ('completada', 'anulada', 'pendiente')),
  observaciones TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS detalle_ventas (
  id SERIAL PRIMARY KEY,
  venta_id INTEGER REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id INTEGER REFERENCES productos(id),
  cantidad INTEGER NOT NULL,
  precio_unitario DECIMAL(10,2) NOT NULL,
  descuento DECIMAL(10,2) DEFAULT 0,
  subtotal DECIMAL(10,2) NOT NULL
);

-- =============================================
-- CAJA
-- =============================================
CREATE TABLE IF NOT EXISTS sesiones_caja (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  monto_apertura DECIMAL(10,2) NOT NULL DEFAULT 0,
  monto_cierre DECIMAL(10,2),
  monto_esperado DECIMAL(10,2),
  diferencia DECIMAL(10,2),
  estado VARCHAR(20) DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
  observaciones TEXT,
  apertura_at TIMESTAMP DEFAULT NOW(),
  cierre_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS movimientos_caja (
  id SERIAL PRIMARY KEY,
  sesion_id INTEGER REFERENCES sesiones_caja(id),
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  monto DECIMAL(10,2) NOT NULL,
  concepto VARCHAR(200) NOT NULL,
  referencia_venta_id INTEGER REFERENCES ventas(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- =============================================
-- SERVICIO TÉCNICO (especializado en iPhones)
-- =============================================
CREATE TABLE IF NOT EXISTS ordenes_servicio (
  id SERIAL PRIMARY KEY,
  numero_orden VARCHAR(50) UNIQUE NOT NULL,
  cliente_id INTEGER REFERENCES clientes(id),
  tecnico_id INTEGER REFERENCES usuarios(id),
  recibido_por INTEGER REFERENCES usuarios(id),
  -- Datos del equipo
  modelo_iphone_id INTEGER REFERENCES modelos_iphone(id),
  imei VARCHAR(20),             -- Identificador único del iPhone
  capacidad VARCHAR(20),        -- 128GB, 256GB, etc.
  color VARCHAR(50),
  condicion_entrada TEXT,       -- Descripción del estado físico al entrar
  -- Diagnóstico y trabajo
  problema_reportado TEXT NOT NULL,
  diagnostico TEXT,
  trabajo_realizado TEXT,
  -- Costos
  costo_repuestos DECIMAL(10,2) DEFAULT 0,
  costo_mano_obra DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) DEFAULT 0,
  -- Estado
  estado VARCHAR(30) DEFAULT 'recibido' CHECK (estado IN (
    'recibido', 'diagnostico', 'en_reparacion',
    'esperando_repuesto', 'listo', 'entregado', 'cancelado'
  )),
  prioridad VARCHAR(20) DEFAULT 'normal' CHECK (prioridad IN ('baja', 'normal', 'alta', 'urgente')),
  fecha_estimada DATE,
  observaciones TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repuestos_orden (
  id SERIAL PRIMARY KEY,
  orden_id INTEGER REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  producto_id INTEGER REFERENCES productos(id), -- repuesto del catálogo
  descripcion VARCHAR(200),
  cantidad INTEGER NOT NULL DEFAULT 1,
  precio_unitario DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL
);

-- =============================================
-- DATOS INICIALES (solo configuración base)
-- Los productos e inventario se gestionan desde el frontend
-- =============================================

-- Roles del sistema
INSERT INTO roles (nombre, descripcion) VALUES
  ('admin',    'Administrador con acceso total'),
  ('vendedor', 'Gestión de ventas y clientes'),
  ('tecnico',  'Gestión de servicio técnico'),
  ('cajero',   'Gestión de caja y pagos')
ON CONFLICT (nombre) DO NOTHING;

-- Categorías fijas del negocio
INSERT INTO categorias (nombre, descripcion) VALUES
  ('iPhone',    'Teléfonos iPhone nuevos y usados'),
  ('Repuesto',  'Piezas y repuestos para iPhones'),
  ('Accesorio', 'Accesorios compatibles con iPhone')
ON CONFLICT (nombre) DO NOTHING;

-- Modelos de iPhone de referencia (el admin puede agregar más desde el frontend)
INSERT INTO modelos_iphone (nombre, anio) VALUES
  ('iPhone 11',       2019),
  ('iPhone 11 Pro',   2019),
  ('iPhone 12',       2020),
  ('iPhone 12 Pro',   2020),
  ('iPhone 13',       2021),
  ('iPhone 13 Pro',   2021),
  ('iPhone 14',       2022),
  ('iPhone 14 Pro',   2022),
  ('iPhone 15',       2023),
  ('iPhone 15 Pro',   2023),
  ('iPhone 16',       2024),
  ('iPhone 16 Pro',   2024)
ON CONFLICT (nombre) DO NOTHING;

-- Usuario admin inicial (password se establece al hacer el primer login o seed)
-- NOTA: Ejecutar el seed desde la app para generar el hash correcto
-- Ver: database/seed.js
