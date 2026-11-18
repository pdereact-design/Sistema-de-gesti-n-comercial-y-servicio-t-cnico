# MonoManzana — Backend

API REST para el sistema de gestión de MonoManzana, tienda especializada en iPhones, repuestos y accesorios.

**Stack:** Node.js · Express 5 · PostgreSQL 15+ · JWT

---

## Requisitos

- Node.js 18 o superior
- PostgreSQL 15 o superior
- npm 9 o superior

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone <url-del-repositorio>
cd monomanzana-backend

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales reales
```

---

## Configuración de PostgreSQL

### Primera vez (base de datos nueva)

```bash
# Crear la base de datos monomanzana_db
# Requiere DB_ADMIN_USER y DB_ADMIN_PASSWORD en .env con permiso CREATEDB
npm run db:setup

# Aplicar las 8 migraciones (crea todas las tablas)
npm run db:migrate

# Crear el usuario administrador inicial
# Requiere ADMIN_PASSWORD en .env (mínimo 8 caracteres)
npm run db:seed
```

Las migraciones son idempotentes: si ya fueron aplicadas, se omiten automáticamente. No las ejecutes en una base con datos existentes si las tablas ya están creadas.

### Migraciones incluidas

| # | Archivo | Descripción |
|---|---|---|
| 001 | initial_schema.sql | Tablas base: usuarios, roles, productos, ventas, caja, servicio técnico |
| 002 | roles_update.sql | Renombra vendedor → ventas, agrega almacen |
| 003 | eliminacion_rol_cajero.sql | Migra cajero → ventas, elimina rol cajero |
| 004 | categorias_activo.sql | Agrega columna activo a categorías |
| 005 | productos_variantes.sql | Tabla variantes_producto y unidades_fisicas |
| 006 | inventario_variantes.sql | Vincula inventario con variantes, agrega triggers de integridad |
| 007 | detalle_ventas_variante.sql | Agrega variante_id y unidad_fisica_id a detalle_ventas |
| 008 | servicio_tecnico.sql | Agrega campos de cobro a órdenes de servicio |

---

## Ejecución

```bash
# Desarrollo (con recarga automática)
npm run dev

# Producción
npm start
```

El servidor inicia en `http://localhost:3000` (o el `PORT` configurado en `.env`).

**Verificar estado:**
```
GET /api/health
```
Responde con el estado del servidor y la conexión a PostgreSQL.

---

## Autenticación

Todas las rutas (excepto `/api/health` y `/api/auth/login`) requieren un token JWT en el header:

```
Authorization: Bearer <token>
```

Obtener token:
```
POST /api/auth/login
{ "email": "admin@monomanzana.com", "password": "<ADMIN_PASSWORD>" }
```

### Roles disponibles

| Rol | Descripción |
|---|---|
| `admin` | Acceso completo |
| `ventas` | Ventas, clientes, caja |
| `almacen` | Productos, categorías, inventario |
| `tecnico` | Órdenes de servicio técnico asignadas |

---

## Endpoints

### Autenticación — `/api/auth`

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/login` | No | Iniciar sesión |
| GET | `/me` | Sí | Usuario autenticado |
| POST | `/cambiar-password` | Sí | Cambiar contraseña |

### Usuarios — `/api/usuarios`

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/` | admin | Listar usuarios |
| GET | `/?buscar=texto` | admin | Buscar por nombre o email |
| GET | `/:id` | admin | Consultar por ID |
| GET | `/roles` | todos | Listar roles disponibles |
| POST | `/` | admin | Registrar usuario |
| PUT | `/:id` | admin | Editar usuario |
| PATCH | `/:id/estado` | admin | Activar o desactivar |
| DELETE | `/:id` | admin | Desactivar usuario |

### Clientes — `/api/clientes`

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/` | admin, ventas, tecnico | Listar clientes |
| GET | `/?buscar=texto` | admin, ventas, tecnico | Buscar por nombre, cédula o teléfono |
| GET | `/?activo=true` | admin, ventas, tecnico | Filtrar por estado |
| GET | `/:id` | admin, ventas, tecnico | Consultar por ID |
| POST | `/` | admin, ventas | Registrar cliente |
| PUT | `/:id` | admin, ventas | Editar cliente |
| PATCH | `/:id/estado` | admin | Activar o desactivar |

### Categorías — `/api/categorias`

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/` | todos | Listar categorías |
| GET | `/:id` | todos | Consultar por ID |
| POST | `/` | admin, almacen | Registrar categoría |
| PUT | `/:id` | admin, almacen | Editar categoría |
| PATCH | `/:id/estado` | admin, almacen | Activar o desactivar |

### Modelos de iPhone — `/api/modelos`

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/` | todos | Listar modelos |
| GET | `/:id` | todos | Consultar por ID |
| POST | `/` | admin, almacen | Registrar modelo |
| PUT | `/:id` | admin, almacen | Editar modelo |
| PATCH | `/:id/estado` | admin, almacen | Activar o desactivar |

### Productos — `/api/productos`

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/` | todos | Listar productos |
| GET | `/?buscar=&tipo=&categoria_id=&activo=` | todos | Filtrar (tipo: iphone, repuesto, accesorio) |
| GET | `/:id` | todos | Detalle con variantes |
| POST | `/` | admin, almacen | Registrar producto |
| PUT | `/:id` | admin, almacen | Editar producto |
| PATCH | `/:id/estado` | admin, almacen | Activar o desactivar |

**Variantes** (anidadas bajo productos):

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/:productoId/variantes` | todos | Listar variantes |
| GET | `/:productoId/variantes/:id` | todos | Consultar variante |
| POST | `/:productoId/variantes` | admin, almacen | Registrar variante |
| PUT | `/:productoId/variantes/:id` | admin, almacen | Editar variante |
| PATCH | `/:productoId/variantes/:id/estado` | admin, almacen | Activar o desactivar |

### Inventario — `/api/inventario`

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/` | todos | Listar existencias |
| GET | `/alertas` | todos | Variantes bajo stock mínimo |
| GET | `/movimientos` | todos | Historial de movimientos |
| GET | `/unidades` | todos | iPhones individuales (IMEI) |
| GET | `/:varianteId` | todos | Stock de una variante |
| POST | `/entrada` | admin, almacen | Registrar entrada de stock |
| POST | `/salida` | admin, almacen | Registrar salida de stock |
| POST | `/ajuste` | admin, almacen | Ajuste de inventario |
| PATCH | `/unidades/:id/estado` | admin, almacen, tecnico | Cambiar estado de unidad |

**Entrada de iPhone** (requiere IMEI):
```json
{ "variante_id": 1, "tipo_identificador": "imei", "identificador": "354512341234567", "precio_compra": 650, "motivo": "Compra equipo" }
```

**Entrada de repuesto/accesorio**:
```json
{ "variante_id": 5, "cantidad": 10, "motivo": "Compra proveedor" }
```

### Ventas — `/api/ventas`

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/` | admin, ventas | Listar ventas |
| GET | `/:id` | admin, ventas | Detalle con líneas |
| POST | `/` | admin, ventas | Registrar venta |
| POST | `/:id/anular` | admin | Anular venta y devolver stock |

Registrar venta requiere sesión de caja abierta. El precio se lee de la variante en la DB.

```json
POST /api/ventas
{
  "metodo_pago": "efectivo",
  "items": [
    { "variante_id": 5, "cantidad": 2 },
    { "variante_id": 3, "cantidad": 1, "identificador": "354512341234567" }
  ]
}
```

Métodos de pago: `efectivo`, `tarjeta`, `transferencia`, `mixto`. Para `mixto` se requiere `monto_efectivo`.

### Caja — `/api/caja`

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| POST | `/abrir` | admin, ventas | Abrir sesión con monto inicial |
| GET | `/sesion-activa` | admin, ventas | Consultar sesión abierta |
| GET | `/sesiones` | admin, ventas | Historial de sesiones |
| GET | `/sesiones/:id` | admin, ventas | Detalle de sesión con movimientos |
| POST | `/movimiento` | admin, ventas | Ingreso o egreso manual |
| GET | `/movimientos` | admin, ventas | Movimientos de la sesión activa |
| POST | `/cerrar` | admin, ventas | Cerrar sesión y registrar diferencia |

### Servicio Técnico — `/api/servicio`

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | `/` | admin, ventas, tecnico | Listar órdenes |
| GET | `/:id` | admin, ventas, tecnico | Detalle con repuestos |
| POST | `/` | admin, ventas, tecnico | Crear orden |
| PUT | `/:id/diagnostico` | admin, tecnico | Actualizar diagnóstico y costos |
| PATCH | `/:id/estado` | admin, tecnico | Cambiar estado |
| PATCH | `/:id/tecnico` | admin | Asignar técnico |
| POST | `/:id/repuestos` | admin, tecnico | Agregar repuesto (descuenta stock) |
| POST | `/:id/cobrar` | admin, ventas | Cobrar y marcar como entregada |
| POST | `/:id/cancelar` | admin | Cancelar y devolver repuestos |

Estados de orden: `recibido → diagnostico → en_reparacion → esperando_repuesto → listo → entregado`

---

## Pruebas automatizadas

```bash
# Ejecutar los 10 casos funcionales y de concurrencia
node tests/run-tests.js
```

Crea `monomanzana_test` automáticamente, ejecuta las pruebas y la elimina al terminar. Requiere `DB_ADMIN_USER` y `DB_ADMIN_PASSWORD` en `.env`.

```bash
# Verificar que los 26 módulos cargan sin errores
node tests/check-modules.js
```

---

## Estructura del proyecto

```
monomanzana-backend/
├── database/
│   ├── migrations/        # 8 migraciones SQL (001–008)
│   ├── migrate.js          # Runner de migraciones
│   ├── seed.js             # Crea usuario admin inicial
│   └── setup.js            # Crea la base de datos
├── src/
│   ├── config/db.js        # Pool de conexiones PostgreSQL
│   ├── controllers/        # Lógica de cada módulo (11 archivos)
│   ├── middlewares/        # JWT (verifyToken, verifyRole) y errorHandler
│   ├── routes/             # Rutas de la API (10 archivos)
│   ├── services/           # Lógica reutilizable (inventario, ventas, servicio)
│   ├── utils/validators.js # Validaciones numéricas y de cadenas
│   └── app.js              # Punto de entrada del servidor
├── tests/
│   ├── funcional/          # Pruebas de caja, ventas y servicio técnico
│   ├── setup/              # Helpers de DB y servidor para pruebas
│   ├── check-modules.js    # Verifica carga de módulos
│   └── run-tests.js        # Runner de las 3 suites
├── .env.example            # Plantilla de variables de entorno
├── .gitignore
└── package.json
```

---

## Notas para el desarrollador de frontend

- Todos los endpoints devuelven `{ success: boolean, data: ..., message: string }`.
- Los errores devuelven el código HTTP correspondiente con `{ success: false, message: "..." }`.
- El token JWT se obtiene en `/api/auth/login` y dura 8 horas por defecto.
- Para ventas e inventario, los precios se leen de la base de datos, no del cliente.
- La caja debe estar abierta antes de registrar ventas o cobros de servicio técnico.
- Los iPhones requieren IMEI para registrarse en inventario y para venderse.
