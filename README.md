# Tranky Backend

API del **portal de residentes de edificios Tranky**: propietarios e inquilinos pagan sus cuotas de mantenimiento, ven lo pendiente y lo pagado, y consultan sus propiedades (departamento, depósito y cochera). Incluye también el soporte para la administradora (padrón, emisión de cuotas y monitor de cobranza).

- **Guía funcional (fuente de verdad):** [`rules/FSD-002_Tranky_Portal_Residentes.md`](rules/FSD-002_Tranky_Portal_Residentes.md)
- **Guía para el equipo frontend (endpoints y ejemplos):** [`docs/API_FRONTEND.md`](docs/API_FRONTEND.md)

---

## Índice

1. [Puesta en marcha](#1-puesta-en-marcha)
2. [Comandos disponibles](#2-comandos-disponibles)
3. [Qué se desarrolló](#3-qué-se-desarrolló)
4. [Arquitectura y estructura de carpetas](#4-arquitectura-y-estructura-de-carpetas)
5. [Modelo de datos](#5-modelo-de-datos)
6. [Cómo funciona por dentro](#6-cómo-funciona-por-dentro)
7. [Seguridad: cómo se cumplen las reglas críticas](#7-seguridad-cómo-se-cumplen-las-reglas-críticas)
8. [Configuración (.env)](#8-configuración-env)
9. [Pruebas](#9-pruebas)
10. [Decisiones tomadas y pendientes](#10-decisiones-tomadas-y-pendientes)
11. [Solución de problemas](#11-solución-de-problemas)

---

## 1. Puesta en marcha

### Requisitos

| Requisito | Versión | Para qué |
|---|---|---|
| Node.js | 22 o superior | Ejecutar la API |
| Docker Desktop | Cualquiera reciente | Contenedor de PostgreSQL 16 |
| Contenedor Postgres | `recaudadora-postgres` (puerto 5432) | Aloja las bases `tranky_db` y `tranky_test` |

El backend **no levanta su propio contenedor**: usa el Postgres que ya corre en Docker (hoy, el del proyecto Recaudadora). Dentro de él tiene su propio rol `tranky` y sus propias bases, sin tocar las del otro proyecto.

### Primera vez (instalación completa)

Desde una terminal en la carpeta del proyecto (`Tranky Backend`):

```powershell
# 1. Verificar que el contenedor de Postgres esté corriendo (debe aparecer "Up")
docker ps --filter "name=recaudadora-postgres"
# Si no aparece, levantarlo:
docker start recaudadora-postgres

# 2. Instalar dependencias
npm install

# 3. Crear el archivo .env a partir de la plantilla y completar los valores <...>
Copy-Item .env.example .env
#    Para generar secretos aleatorios (JWT_SECRET, OTP_PEPPER, DB_PASSWORD, WEBHOOK_SECRET_MOCK):
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 4. Crear el rol y las bases de datos dentro del contenedor (usa los valores del .env)
npm run db:create

# 5. Crear las tablas y cargar datos de prueba
npm run db:reset

# 6. Levantar la API
npm run dev
```

> En esta PC el `.env` ya existe y las bases ya están creadas: basta con los pasos 1 y 6.

### Día a día

```powershell
docker start recaudadora-postgres   # solo si el contenedor está detenido
npm run dev                         # API en http://localhost:3001 (se reinicia sola al guardar código)
```

Para detener la API: `Ctrl + C` en la terminal donde corre.

### Verificar que funciona

```powershell
# Salud del servicio -> {"status":"ok","service":"tranky-api"}
Invoke-RestMethod http://localhost:3001/health

# Login de un residente de prueba (la contraseña es SEED_PASSWORD_RESIDENTES del .env)
$body = @{ tipo_doc = "DNI"; num_doc = "45678901"; password = "<SEED_PASSWORD_RESIDENTES>" } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post http://localhost:3001/api/v1/auth/login -ContentType "application/json" -Body $body

# Unidades del residente
Invoke-RestMethod http://localhost:3001/api/v1/payer/units -Headers @{ Authorization = "Bearer $($login.token)" }
```

Usuarios de prueba que crea `npm run db:reset`:

| Usuario | Login | Contraseña |
|---|---|---|
| Juan (propietario de 4 unidades en 2 edificios) | DNI `45678901` | `SEED_PASSWORD_RESIDENTES` |
| María (inquilina del DPTO-402) | DNI `41234567` | `SEED_PASSWORD_RESIDENTES` |
| Carla (propietaria del DPTO-501) | DNI `47890123` | `SEED_PASSWORD_RESIDENTES` |
| Luis (ex inquilino, sin unidades activas) | DNI `40011122` | `SEED_PASSWORD_RESIDENTES` |
| Administradora Tranquila | `admin@tranquila.pe` | `SEED_PASSWORD_ADMIN` |
| Administradora Lima Norte | `admin@limanorte.pe` | `SEED_PASSWORD_ADMIN` |

---

## 2. Comandos disponibles

| Comando | Qué hace | Cuándo usarlo |
|---|---|---|
| `npm install` | Instala dependencias | Primera vez o cuando cambie `package.json` |
| `npm run dev` | Levanta la API en modo desarrollo, con reinicio automático al guardar archivos `.js` | Desarrollo diario |
| `npm start` | Levanta la API sin reinicio automático | Producción o pruebas manuales |
| `npm run db:create` | Crea (o sincroniza) el rol `DB_USER` y las bases `DB_NAME` y `DB_NAME_TEST` en el contenedor `DOCKER_DB_CONTAINER`. Si cambias `DB_PASSWORD`, vuelve a correrlo para aplicarla en Postgres. | Primera vez o al cambiar credenciales de la base |
| `npm run db:migrate` | Aplica las migraciones pendientes de `db/migrations` (no borra datos) | Cuando se agregue una migración nueva |
| `npm run db:seed` | Carga los datos de prueba (solo si la base está vacía) | Rara vez; normalmente se usa `db:reset` |
| `npm run db:reset` | **Borra todo** `tranky_db`, recrea las tablas y carga los datos de prueba | Volver a un estado limpio en desarrollo (prohibido en producción) |
| `npm test` | Ejecuta las 34 pruebas end-to-end contra `tranky_test` (no toca la base de desarrollo) | Antes de entregar cambios |

> Si editas el `.env`, detén `npm run dev` y vuelve a lanzarlo: el reinicio automático solo vigila el código, no el `.env`.

---

## 3. Qué se desarrolló

Una API REST (`/api/v1`) que implementa el FSD-002 sobre un núcleo de recaudación multi-tenant.

### Portal del residente (Tranky PWA)

| Requerimiento | Qué hace la API |
|---|---|
| RF-R-01 Inicio de sesión | Login con documento + contraseña o con OTP de 6 dígitos por WhatsApp/SMS. Mensaje genérico si el documento no existe. Bloqueo tras 5 intentos fallidos. |
| RF-R-02 Selector de unidades | Lista las unidades con relación activa, agrupadas por edificio y tipo. |
| RF-R-03 Dashboard | Deuda total, deuda vencida y próximo vencimiento, por moneda. «Estás al día» si no hay deuda. |
| RF-R-04 Mis propiedades | Edificios → tipos → unidades con saldos, subtotales y total general. Reporte de dato incorrecto a la administradora. |
| RF-R-05 Cuotas pendientes | Ordenadas por vencimiento, con desglose, mora y aviso de cobranza en PDF. |
| RF-R-06 Historial | Pagos confirmados, total histórico, extornos vinculados y comprobante PDF. |
| RF-R-07 a RF-R-10 Checkout | Pago de varias cuotas en una operación con Yape, tarjeta (guardada o nueva, con 3DS) o código CIP/QR. |
| RF-R-11 Billetera | Alta, listado, predeterminada y baja de tarjetas tokenizadas. |
| RF-R-12 Débito automático | Se guarda el interruptor (la ejecución de cargos automáticos está pendiente). |
| RF-R-13 Notificaciones | Avisos de cobranza, recibos y rechazos encolados con reintentos (hoy se escriben en el log). |
| RF-R-14 Link de WhatsApp | Link de un solo uso, con expiración, que permite pagar una cuota sin login. |

### Soporte a la administradora (portal B2B)

| Requerimiento | Qué hace la API |
|---|---|
| RF-S-01 Padrón | Crear y editar edificios, unidades (departamento, depósito, cochera) y residentes con su rol. |
| RF-S-02 Importación `.xlsx` | Valida todo el archivo y reporta errores por fila; solo aplica si no hay errores. |
| RF-S-03 Emisión masiva | Genera las cuotas del periodo por monto fijo o por alícuota, sin duplicar, y encola los avisos. |
| RF-S-04 Mora | Job diario a las 00:01 (hora de Lima): marca vencidas y recalcula la mora según la regla del edificio. |
| RF-S-05 Monitor | KPIs (emitido, recaudado, % de efectividad, mora), listados de cuotas y transacciones. |

---

## 4. Arquitectura y estructura de carpetas

### Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 22 (ES Modules) |
| HTTP | Express 5 |
| Base de datos | PostgreSQL 16 con el driver `pg` (SQL directo, sin ORM) |
| Validación | Zod 4 (mensajes en español) |
| Autenticación | JWT (`jsonwebtoken`) + `bcryptjs` para contraseñas |
| Jobs | `node-cron` |
| PDFs | `pdfkit` |
| Excel | `exceljs` |
| Logs | `pino` (JSON estructurado con correlation-id) |
| Seguridad HTTP | `helmet`, `cors`, `express-rate-limit` |
| Pruebas | `node:test` (incluido en Node) |

### Cómo viaja una petición

```text
Cliente (PWA / portal B2B)
   │  HTTP JSON
   ▼
src/app.js ── requestContext (correlation-id + log) ── helmet ── cors ── rate limit
   │
   ├── /api/v1/webhooks  (cuerpo crudo para validar la firma HMAC)
   ├── /api/v1/auth      login residente / OTP / login administradora
   ├── /api/v1/payer     portal del residente      (token PAYER)
   ├── /api/v1/payments  checkout y estado del pago (token PAYER o PAY_LINK)
   ├── /api/v1/tenant    portal B2B                (token TENANT_ADMIN)
   └── /api/v1/dev       simuladores (solo desarrollo)
   │
   ▼
*.routes.js   valida entrada (Zod) y autentica
   ▼
*.service.js  reglas de negocio, transacciones SQL
   ▼
PostgreSQL (tranky_db) ── triggers que protegen el ledger
```

### Carpetas

```text
Tranky Backend/
├── rules/                     Guía funcional (FSD-002)
├── docs/API_FRONTEND.md       Contrato de la API para el frontend
├── db/
│   ├── bootstrap.sql          Crea rol y bases (sin credenciales; las inyecta db:create)
│   └── migrations/            Esquema versionado
│       ├── 001_core.sql           Tablas
│       └── 002_ledger_guards.sql  Triggers de inmutabilidad del ledger
├── src/
│   ├── server.js              Arranque: conecta a la BD, inicia jobs y el servidor HTTP
│   ├── app.js                 Configuración de Express y montaje de rutas
│   ├── config/
│   │   ├── env.js                 Lee y valida el .env
│   │   ├── rubros.js              Catálogo del rubro: tipos de unidad, atributos y etiquetas
│   │   └── organizationUnitConfig.js  Reglas por edificio: mora y permisos por rol
│   ├── db/                    Pool de conexiones y scripts create / migrate / reset / seed
│   ├── middleware/            auth (JWT), requestContext (logs), rateLimits
│   ├── jobs/index.js          Programación de jobs (mora, expiración de pagos, notificaciones)
│   ├── shared/                Utilidades: errores, montos, seguridad, auditoría, validación, logger
│   └── modules/
│       ├── auth/              Login residente (contraseña y OTP), login administradora
│       ├── payer/             Unidades, propiedades, cuotas, historial, billetera, reportes
│       ├── payments/          Checkout, comisiones, transiciones de estado, expiración
│       ├── webhooks/          Recepción de confirmaciones de la pasarela
│       ├── gateways/          Interfaz de pasarela (Strategy) + pasarela simulada
│       ├── payLinks/          Links de pago de WhatsApp
│       ├── debts/             Cálculo de mora
│       ├── notifications/     Cola de notificaciones y proveedores de envío
│       ├── documents/         PDFs (aviso de cobranza y comprobante)
│       ├── tenant/            Portal B2B: padrón, importación, emisión, monitor
│       └── dev/               Simulador de pasarela y jobs a demanda (solo desarrollo)
└── tests/                     Pruebas end-to-end
```

Cada módulo separa **rutas** (`*.routes.js`: HTTP, validación, autenticación) de **servicios** (`*.service.js`: lógica de negocio y SQL).

---

## 5. Modelo de datos

El esquema sigue FSD-002 §10. Es **agnóstico del rubro**: no hay tablas llamadas «edificios» o «cocheras»; el vocabulario inmobiliario vive en `src/config/rubros.js`.

| Tabla | Representa | Notas |
|---|---|---|
| `tenants` | Administradora | `config_comision_json`: tipo de comisión y quién la asume |
| `bank_accounts` | Cuenta bancaria de la junta | Destino de las liquidaciones |
| `organization_units` | Edificio | `config_json`: regla de mora y permisos por rol |
| `billing_units` | Departamento, depósito o cochera | `tipo_unidad` + atributos en `metadata_json` |
| `payers` | Residente (persona) | Global: puede tener unidades en varias administradoras |
| `unit_payer_relations` | Vínculo residente ↔ unidad | Rol `PROPIETARIO` / `INQUILINO`; se desactiva, nunca se borra |
| `debts` | Cuota | `tipo_cuota` (ordinaria/extraordinaria), montos, desglose, estado |
| `transactions` | Pago (ledger) | Montos inmutables; extornos como asiento inverso |
| `transaction_debts` | Cuotas cubiertas por cada pago | Permite pagar varias cuotas en una operación |
| `payment_methods_vault` | Tarjetas guardadas | Solo token, marca y últimos 4 dígitos |
| `settlements` | Liquidación a la junta | Preparada; el motor está pendiente |
| `webhook_events` | Eventos recibidos de la pasarela | Evita procesar dos veces el mismo evento |
| `pay_links` | Links de pago de WhatsApp | Solo se guarda el hash del token |
| `otp_challenges` | Códigos OTP de login | Hash, expiración e intentos |
| `notifications` | Cola de mensajes (outbox) | Estado, reintentos y errores |
| `data_issues` | Reportes de dato incorrecto | Enviados por residentes |
| `audit_logs` | Auditoría de accesos y cambios | Inmutable |

**Aislamiento entre administradoras:** las tablas del tenant llevan `tenant_id` y claves foráneas compuestas `(id, tenant_id)`. Así la base impide, por ejemplo, que una cuota apunte a una unidad de otra administradora.

---

## 6. Cómo funciona por dentro

### 6.1 Quién ve y paga qué (permisos por rol)

Cada edificio define en `organization_units.config_json` qué tipos de cuota puede **ver** y **pagar** cada rol, y si ve el historial de toda la unidad o solo sus pagos. Si el edificio no lo define, se usan los valores por defecto de FSD-002 §4.1:

| Rol | Ve | Paga | Historial |
|---|---|---|---|
| Propietario | Ordinarias y extraordinarias | Ordinarias y extraordinarias | Toda la unidad |
| Inquilino | Ordinarias | Ordinarias | Solo sus propios pagos |

Todo acceso del residente pasa por `src/modules/payer/access.service.js`, que solo devuelve unidades con relación **activa** y calcula los permisos efectivos.

### 6.2 Flujo de pago

```text
1. POST /payments/checkout  (con Idempotency-Key)
   ├─ ¿Esa clave ya se usó? → devuelve el mismo pago (no cobra dos veces)
   ├─ Transacción SQL:
   │    SELECT ... FOR UPDATE sobre las cuotas (bloqueo)
   │    valida: visibles, pagables por el rol, PENDIENTE/VENCIDO, mismo edificio y moneda
   │    calcula montos desde la BD (comisión, IGV)
   │    crea la transacción INICIADO + filas en transaction_debts
   │    cuotas → EN_PROCESO
   ├─ Llama a la pasarela (fuera de la transacción SQL)
   │    rechazo inmediato → transacción FALLIDO, cuotas liberadas, respuesta 402
   │    aceptado          → guarda el id del cargo, respuesta 202 «en proceso»
   ▼
2. La pasarela envía el webhook firmado → POST /webhooks/gateway/{provider}
   ├─ valida la firma HMAC (si es inválida → 401 y alerta en el log)
   ├─ registra el evento; si ya existía → lo ignora
   ├─ charge.succeeded → transacción EXITOSO, cuotas PAGADO, encola el recibo
   └─ charge.failed    → transacción FALLIDO, cuotas liberadas, encola el aviso de rechazo
   ▼
3. La PWA consulta GET /payments/{id}/status hasta ver PAGADO o FALLIDO
```

- **Liberar cuotas:** vuelven a `VENCIDO` si ya pasó su fecha, o a `PENDIENTE` si no, y se recalcula la mora.
- **Expiración:** un job revisa cada minuto los intentos vencidos (30 min para Yape y tarjeta, 24 h para CIP). Antes de liberar consulta a la pasarela; si figura como cobrado, espera el webhook en lugar de liberar.

### 6.3 Comisiones (`src/modules/payments/fees.js`)

- Comisión de la recaudadora = fijo + porcentaje × deuda, según `config_comision_json` del tenant.
- IGV solo sobre esa comisión (`IGV_TASA`).
- Si la comisión la asume el **pagador**, se suma al total; si la asume el **tenant**, se descuenta del neto a liquidar.
- Los montos se calculan en céntimos enteros para evitar errores de redondeo.

### 6.4 Mora (`src/modules/debts/mora.service.js`)

Regla por edificio: `NINGUNA`, `PENALIDAD_FIJA` (monto único) o `INTERES_DIARIO` (% diario sobre el monto base), con días de gracia y tope. Se calcula a partir de los días vencidos, así que correr el job dos veces el mismo día no duplica recargos. Las cuotas `EN_PROCESO` no se tocan mientras dura el intento de pago.

### 6.5 Notificaciones (`src/modules/notifications`)

Los servicios no envían mensajes directamente: los insertan en la tabla `notifications` dentro de la misma transacción. Un job cada 15 segundos los envía con reintentos y espera creciente (hasta 5 intentos). El proveedor actual solo los escribe en el log; para conectar WhatsApp, SMS o email hay que implementar un proveedor con la misma función `send`.

Los avisos de cobranza generan su link de pago en el momento de enviarse.

### 6.6 Pasarelas (`src/modules/gateways`)

`PaymentGateway.js` define la interfaz común: cobrar, consultar, extornar, estimar comisión y validar o leer el webhook. Hoy solo existe `MockGateway.js`, que simula los cobros. Para integrar Culqi, Niubiz, Izipay o Yape hay que crear un adaptador con esa interfaz, registrarlo en `registry.js` y elegirlo por método de pago en el `.env` (`PASARELA_YAPE`, `PASARELA_CARD`, `PASARELA_CIP`). El resto del código no cambia.

### 6.7 Jobs programados (`src/jobs/index.js`)

| Job | Frecuencia | Qué hace |
|---|---|---|
| `mora-diaria` | 00:01 hora de Lima | Pasa cuotas a VENCIDO y recalcula la mora |
| `expiracion-pagos` | Cada minuto | Libera intentos de pago y CIP vencidos |
| `notificaciones` | Cada 15 segundos | Envía la cola de notificaciones |

En desarrollo se pueden ejecutar a demanda con `POST /api/v1/dev/jobs/{mora|expiracion|notificaciones}`.

### 6.8 Herramientas de desarrollo

Solo existen con `ENABLE_DEV_ROUTES=true` y fuera de producción:

- `POST /api/v1/dev/mock-gateway/transactions/{id}/succeed` o `/fail`: simula el webhook de la pasarela.
- `POST /api/v1/dev/pay-links`: genera un link de pago de WhatsApp de prueba.
- `POST /api/v1/dev/jobs/{job}`: ejecuta un job al instante.

Detalle en [`docs/API_FRONTEND.md` §11](docs/API_FRONTEND.md#11-herramientas-de-desarrollo-pasarela-simulada).

---

## 7. Seguridad: cómo se cumplen las reglas críticas

| Regla (FSD-002 §12) | Implementación |
|---|---|
| 1. Idempotencia estricta | `Idempotency-Key` obligatorio y único por transacción; reintentos devuelven el mismo pago. Webhooks idempotentes por `(provider, event_id)`. |
| 2. Bloqueo pesimista | `SELECT ... FOR UPDATE` sobre las cuotas en orden estable; el segundo pagador recibe «Esta cuota tiene un pago en proceso». |
| 3. Ledger inmutable | Triggers en la base prohíben `DELETE` y `TRUNCATE` en `transactions`, `transaction_debts` y `settlements`, y cualquier cambio de montos. |
| 4. Webhook HMAC como fuente de verdad | Solo un webhook con firma válida pasa una cuota a PAGADO. El checkout responde 202, nunca «pagado». |
| 5. Tarjetas solo tokenizadas | Solo se guarda token, marca y últimos 4 dígitos; se rechaza cualquier valor con forma de número de tarjeta. |
| 6. Aislamiento multi-tenant | El portal B2B filtra por el `tenant_id` del token; claves foráneas compuestas en la base. |
| 7. Pasarelas con patrón Strategy | Interfaz `PaymentGateway` + registro de adaptadores. |
| 8. Core agnóstico | Tablas genéricas; el vocabulario del rubro vive en `src/config/rubros.js`. |

Además:
- Contraseñas con bcrypt (12 rondas) y OTP guardado como hash con pepper.
- Rate limiting en login, OTP y checkout.
- Auditoría en `audit_logs`.
- Logs sin contraseñas ni tokens.
- El rol de la base `tranky` no es superusuario, así que los triggers aplican también a la propia API.
- **Todas las credenciales viven solo en `.env`**, que está en `.gitignore`.

---

## 8. Configuración (.env)

La plantilla completa está en [`.env.example`](.env.example). Si falta una variable obligatoria, la API no arranca y avisa cuál.

| Grupo | Variables | Notas |
|---|---|---|
| Servidor | `NODE_ENV`, `PORT`, `LOG_LEVEL`, `TZ_NEGOCIO` | Puerto por defecto 3001; zona horaria `America/Lima` |
| Base de datos | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_NAME_TEST` | Obligatorias: usuario, contraseña y nombre de base |
| Docker | `DOCKER_DB_CONTAINER`, `DOCKER_DB_ADMIN_USER` | Solo para `npm run db:create` |
| Sesión | `JWT_SECRET`, `JWT_EXPIRES_IN`, `OTP_PEPPER` | Secretos obligatorios; en producción el JWT necesita al menos 32 caracteres |
| Login y OTP | `LOGIN_MAX_INTENTOS`, `LOGIN_BLOQUEO_MINUTOS`, `OTP_TTL_MINUTOS`, `OTP_MAX_INTENTOS`, `OTP_REENVIO_SEGUNDOS`, `OTP_DEV_ECHO` | `OTP_DEV_ECHO=true` devuelve el código en la respuesta (solo desarrollo) |
| Pagos | `PAGO_TIMEOUT_MINUTOS`, `CIP_VIGENCIA_HORAS`, `IGV_TASA`, `PASARELA_YAPE`, `PASARELA_CARD`, `PASARELA_CIP` | Pasarela por método de pago |
| Pasarela simulada | `WEBHOOK_SECRET_MOCK`, `MOCK_COMISION_FIJA`, `MOCK_COMISION_PORCENTAJE` | Secreto HMAC de los webhooks simulados |
| Links de pago | `PAY_LINK_BASE_URL`, `PAY_LINK_TTL_HORAS`, `PAY_LINK_CHECKOUT_TTL_MINUTOS` | URL de la PWA a la que apunta el link |
| Notificaciones | `NOTIFICACIONES_CANALES`, `NOTIFICACIONES_MAX_INTENTOS` | Canales: `WHATSAPP`, `EMAIL`, `SMS` |
| Desarrollo | `ENABLE_DEV_ROUTES`, `SEED_PASSWORD_RESIDENTES`, `SEED_PASSWORD_ADMIN` | Nunca habilitar las rutas de desarrollo en producción |

---

## 9. Pruebas

```powershell
npm test
```

- Son 34 pruebas end-to-end que levantan la API en memoria y la ejercitan por HTTP.
- Usan la base `tranky_test`, que se **recrea en cada ejecución**; la base de desarrollo no se toca.
- Cubren los criterios de aceptación del FSD-002: login, permisos por rol, ordenamiento y desglose de cuotas, checkout multi-cuota, idempotencia, pago simultáneo de la misma cuota, webhooks (firma inválida y duplicados), rechazos, expiración de CIP, billetera, link de pago, inmutabilidad del ledger, aislamiento entre administradoras, emisión por alícuota e importación `.xlsx`.

Código: [`tests/api.test.js`](tests/api.test.js) y [`tests/helpers.js`](tests/helpers.js).

### Pruebas manuales con REST Client

[`tests/test.http`](tests/test.http) tiene más de 80 peticiones listas para la extensión **REST Client** (`humao.rest-client`), agrupadas por flujo: login, consultas, billetera, pago con Yape + webhook, tarjeta con 3DS, CIP, link de WhatsApp, portal de la administradora, aislamiento entre administradoras y jobs.

- Ejecútalas **en orden** después de `npm run db:reset`: varias reutilizan el token o los IDs de una respuesta anterior.
- Las contraseñas se leen del `.env` de la raíz con `{{$dotenv ...}}`, así que no hay credenciales en el archivo.

---

## 10. Decisiones tomadas y pendientes

### Decisiones

| Tema | Decisión | Motivo |
|---|---|---|
| Framework | Express en lugar de NestJS o FastAPI (RNF-01) | Pedido explícito; se mantuvo la separación por módulos |
| Base de datos | Bases propias dentro del contenedor Postgres existente | Reutilizar el Docker de la PC sin tocar el otro proyecto |
| Colas | `node-cron` + tabla `notifications` en lugar de Redis + BullMQ (RNF-03) | No hay Redis disponible; los servicios no cambian al migrar |
| Ajustes PROPUESTA del FSD-002 | Implementados (EN_PROCESO, `transaction_debts`, `webhook_events`, `tipo_unidad`, `tipo_cuota`, endpoints nuevos) | El flujo de pago los necesita |
| P-01 a P-03 (permisos y mora) | Configurables por edificio, con los valores por defecto de la sección 6.1 | FSD-002 §14.2 pide no fijarlos en código |
| P-05 (pagos parciales) | No permitidos: cada cuota se paga completa | Pendiente de definir |
| Pagar cuotas de varios edificios juntas | No permitido | Restricción propuesta en RF-R-07 |

### Pendiente

- Integración con pasarelas reales (Culqi, Niubiz, Izipay, Yape).
- Ejecución de los cargos del débito automático.
- Proveedores reales de WhatsApp, SMS y email.
- Motor de liquidación, archivo de dispersión bancaria y facturación electrónica (RF-S-06 y RF-S-07).
- Extornos desde un backoffice.
- Endpoint de cotización para mostrar la comisión antes de confirmar el pago.
- Row Level Security en Postgres como segunda capa de aislamiento.

---

## 11. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `[config] falta la variable de entorno X` | El `.env` no tiene esa variable | Agregarla (ver `.env.example`) y reiniciar `npm run dev` |
| `ECONNREFUSED 127.0.0.1:5432` | El contenedor de Postgres está detenido | `docker start recaudadora-postgres` |
| `password authentication failed for user "tranky"` | `DB_PASSWORD` del `.env` no coincide con la del rol | `npm run db:create` (sincroniza la contraseña) |
| `database "tranky_db" does not exist` | Las bases no se crearon | `npm run db:create` y luego `npm run db:reset` |
| `relation "..." does not exist` | Faltan migraciones | `npm run db:migrate` o `npm run db:reset` |
| `EADDRINUSE :::3001` | Ya hay otra API corriendo en ese puerto | Cerrar la otra terminal o cambiar `PORT` en el `.env` |
| Cambié el `.env` y no se nota | `npm run dev` no relee el `.env` | Detener con `Ctrl + C` y volver a lanzar |
| El login devuelve `ACCOUNT_LOCKED` | 5 intentos fallidos | Esperar 15 minutos o `npm run db:reset` en desarrollo |
| Un pago queda «EN_PROCESO» para siempre en desarrollo | Nadie envió el webhook (la pasarela es simulada) | `POST /api/v1/dev/mock-gateway/transactions/{id}/succeed` |

> **Cuidado:** `docker compose down -v` en el proyecto Recaudadora borra el volumen del contenedor y con él las bases de Tranky. Detener el contenedor sin `-v` es seguro.
