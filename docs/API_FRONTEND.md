# Tranky – Guía de integración para el equipo Frontend

Versión de la API: **v1** · Backend: `Tranky Backend` · Guía funcional: [`rules/FSD-002_Tranky_Portal_Residentes.md`](../rules/FSD-002_Tranky_Portal_Residentes.md)

Este documento reúne todo lo que el frontend necesita para construir:

1. **Tranky (PWA del residente)**: propietarios e inquilinos pagan cuotas, ven pendientes, historial y sus propiedades. Es el alcance principal (RF-R-01 a RF-R-14).
2. **Portal de la administradora (B2B)**: padrón, emisión de cuotas y monitor de cobranza (RF-S-01 a RF-S-05).

Todas las respuestas de ejemplo fueron capturadas de la API real con los datos de prueba (`npm run db:reset`).

---

## Índice

1. [Ambiente local y datos de prueba](#1-ambiente-local-y-datos-de-prueba)
2. [Convenciones generales](#2-convenciones-generales)
3. [Autenticación](#3-autenticación)
4. [Mapa de pantallas → endpoints (PWA del residente)](#4-mapa-de-pantallas--endpoints-pwa-del-residente)
5. [Endpoints del residente](#5-endpoints-del-residente)
6. [Flujo de pago (checkout)](#6-flujo-de-pago-checkout)
7. [Pago desde link de WhatsApp](#7-pago-desde-link-de-whatsapp-rf-r-14)
8. [Endpoints del portal de la administradora (B2B)](#8-endpoints-del-portal-de-la-administradora-b2b)
9. [Catálogos y enumeraciones](#9-catálogos-y-enumeraciones)
10. [Códigos de error](#10-códigos-de-error)
11. [Herramientas de desarrollo (pasarela simulada)](#11-herramientas-de-desarrollo-pasarela-simulada)
12. [Reglas no negociables para el frontend](#12-reglas-no-negociables-para-el-frontend)
13. [Tipos TypeScript sugeridos](#13-tipos-typescript-sugeridos)
14. [Pendiente en el backend](#14-pendiente-en-el-backend)

---

## 1. Ambiente local y datos de prueba

| Dato | Valor |
|---|---|
| Base URL | `http://localhost:3001/api/v1` |
| Health check | `GET http://localhost:3001/health` |
| CORS | Abierto a cualquier origen en desarrollo |
| URL de la PWA esperada para links de pago | `http://localhost:5173/pagar/{token}` (configurable en el backend con `PAY_LINK_BASE_URL`) |

Levantar el backend (requiere Docker con el contenedor de Postgres corriendo y un `.env` completo; pide los valores al equipo backend o parte de `.env.example`):

```bash
npm install
npm run db:create   # crea o sincroniza el rol y las bases con los valores del .env
npm run db:reset    # recrea esquema y datos de prueba (úsalo para volver a un estado limpio)
npm run dev         # API en http://localhost:3001
```

### Usuarios de prueba

Las contraseñas no se publican en este documento: son las variables `SEED_PASSWORD_RESIDENTES` y `SEED_PASSWORD_ADMIN` del `.env` del backend.

| Perfil | Login | Contraseña | Qué permite probar |
|---|---|---|---|
| Juan Pérez – propietario | DNI `45678901` | `SEED_PASSWORD_RESIDENTES` | 4 unidades en 2 edificios (dpto + depósito + cochera en uno; dpto en otro), cuotas vencidas con mora, cuota extraordinaria |
| María Torres – inquilina | DNI `41234567` | `SEED_PASSWORD_RESIDENTES` | Inquilina del DPTO-402: ve solo cuotas ordinarias y solo sus propios pagos |
| Carla Ríos – propietaria | DNI `47890123` | `SEED_PASSWORD_RESIDENTES` | 1 unidad; útil para link de pago |
| Luis Gómez – ex inquilino | DNI `40011122` | `SEED_PASSWORD_RESIDENTES` | Relación desactivada: entra pero no ve unidades |
| Administradora Tranquila | `admin@tranquila.pe` | `SEED_PASSWORD_ADMIN` | Portal B2B del edificio Residencial Los Pinos |
| Administradora Lima Norte | `admin@limanorte.pe` | `SEED_PASSWORD_ADMIN` | Portal B2B de otro tenant (para verificar aislamiento) |

### IDs fijos del seed

| Recurso | ID |
|---|---|
| Edificio Residencial Los Pinos – Torre A | `b1000000-0000-4000-8000-000000000001` |
| Edificio Mirador del Parque | `b2000000-0000-4000-8000-000000000002` |
| DPTO-402 (Juan propietario, María inquilina) | `c1000000-0000-4000-8000-000000000402` |
| DEP-S1-12 (depósito de Juan) | `c1000000-0000-4000-8000-000000000012` |
| COCH-S2-07 (cochera techada de Juan) | `c1000000-0000-4000-8000-000000000007` |
| DPTO-501 (Carla) | `c1000000-0000-4000-8000-000000000501` |
| DPTO-1201 (Juan, otra administradora) | `c2000000-0000-4000-8000-000000001201` |
| Pagador Juan / María / Carla | `d0000000-0000-4000-8000-00000000000{1,2,3}` |

Los IDs de cuotas y pagos se generan en cada `db:reset`: obténlos de los listados.

---

## 2. Convenciones generales

| Tema | Regla |
|---|---|
| Formato | JSON UTF-8. Enviar `Content-Type: application/json` salvo en la carga de `.xlsx` (multipart). |
| **Montos** | **Siempre string decimal con 2 decimales**: `"640.14"`. No convertir a `float` para sumar; usar una librería decimal o céntimos enteros. El frontend **nunca** calcula montos a cobrar: los muestra tal como llegan. |
| Excepción | `detalle_items[].monto` (desglose de una cuota) llega como número: `{"item": "Limpieza", "monto": 80}`. |
| Monedas | `PEN` o `USD`. Formatear con `Intl.NumberFormat('es-PE', { style: 'currency', currency })` → `S/ 640.14`, `US$ 20.00`. Nunca sumar montos de monedas distintas: los totales vienen agrupados por moneda (arrays). |
| Fechas de negocio | `YYYY-MM-DD` (ej. `fecha_vencimiento`, `fecha_emision`), ya en hora de Lima. Mostrar sin conversión de zona horaria. |
| Timestamps | ISO 8601 en UTC (ej. `fecha_pago`, `expira_en`, `created_at`). Mostrar en `America/Lima`. |
| Periodos | `YYYY-MM` (ej. `2026-10`). |
| IDs | UUID v4. |
| Paginación | Query `page` (desde 1) y `page_size` (1–100, por defecto 20). Respuesta: `page`, `page_size`, `total_registros`. |
| Trazabilidad | Cada respuesta trae el header `X-Correlation-Id`. Inclúyelo en reportes de error o logs del front. Puedes enviar tu propio `X-Correlation-Id` (8–64 caracteres alfanuméricos, `.`, `_` o `-`). |
| Rate limiting | Login: 20 intentos / 15 min. Solicitud de OTP: 5 / 15 min. Checkout: 20 / min. Global: 600 / 15 min. Al exceder: `429` con `error.code = RATE_LIMITED`. |

### Formato de error (siempre el mismo)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Datos inválidos",
    "details": [
      { "path": "num_doc", "message": "Número de DNI inválido" },
      { "path": "", "message": "Envía password u otp (no ambos)" }
    ]
  }
}
```

- `code`: estable, úsalo para la lógica del front (ver [§10](#10-códigos-de-error)).
- `message`: texto en español apto para mostrar al usuario.
- `details`: opcional. En errores de validación es un array con `path` (campo) y `message`, útil para marcar campos del formulario.

---

## 3. Autenticación

Se usa `Authorization: Bearer <token>` (JWT). Hay tres tipos de token:

| Tipo | Se obtiene en | Sirve para | Vigencia |
|---|---|---|---|
| `PAYER` | `POST /auth/login` | Todo `/payer/*` y `/payments/*` | 8 h |
| `TENANT_ADMIN` | `POST /auth/admin/login` | Todo `/tenant/*` | 8 h |
| `PAY_LINK` | `GET /payer/pay-links/{token}` | Solo `POST /payments/checkout` de **una** cuota y `GET /payments/{id}/status` | 15 min |

- No hay refresh token: ante un `401` redirigir a login.
- Un token de un tipo usado donde no corresponde devuelve `403 FORBIDDEN`.
- Recomendación: guardar el token en memoria o `sessionStorage`, nunca en `localStorage` compartido con terceros.

### 3.1 Login del residente (RF-R-01)

`POST /auth/login` — público

Con contraseña:

```json
{ "tipo_doc": "DNI", "num_doc": "45678901", "password": "<contraseña>" }
```

Con OTP (después de solicitarlo en 3.2):

```json
{ "tipo_doc": "DNI", "num_doc": "47890123", "otp": "877860" }
```

Reglas de validación del formulario:

| Campo | Regla |
|---|---|
| `tipo_doc` | `DNI`, `CE` o `RUC` |
| `num_doc` | DNI: 8 dígitos · CE: 9–12 alfanuméricos · RUC: 11 dígitos |
| `password` / `otp` | Enviar **solo uno**. OTP: 6 dígitos. |

Respuesta `200`:

```json
{
  "token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": "8h",
  "pagador": {
    "id": "d0000000-0000-4000-8000-000000000001",
    "tipo_doc": "DNI",
    "num_doc": "45678901",
    "nombres": "Juan",
    "apellidos": "Pérez Salas",
    "tiene_password": true
  }
}
```

Si `tiene_password` es `false` (residente que solo entra por OTP), ofrecer crear contraseña con `PUT /payer/me/password`.

Errores:

| HTTP | code | Qué mostrar |
|---|---|---|
| 401 | `INVALID_CREDENTIALS` | «Documento o credenciales incorrectos» (mismo mensaje exista o no el documento) |
| 401 | `OTP_INVALID` | Código inválido o vencido. Ofrecer **reenviar código**. |
| 429 | `ACCOUNT_LOCKED` | Bloqueo temporal por intentos fallidos (5 intentos → 15 min) |
| 429 | `RATE_LIMITED` | Demasiados intentos desde este dispositivo |

### 3.2 Solicitar OTP por WhatsApp o SMS

`POST /auth/otp` — público

```json
{ "tipo_doc": "DNI", "num_doc": "47890123", "canal": "WHATSAPP" }
```

`canal`: `WHATSAPP` (por defecto) o `SMS`. Respuesta `202` (igual exista o no el documento):

```json
{
  "mensaje": "Si el documento está registrado, enviaremos un código a tu teléfono.",
  "dev_otp": "877860"
}
```

- `dev_otp` **solo existe en desarrollo** para probar sin WhatsApp. En producción no viene.
- El código vence en 5 minutos y admite 3 intentos.
- Se puede reenviar después de 60 segundos; antes de eso la API responde igual pero no envía otro código. Mostrar un contador de 60 s en el botón «Reenviar».

### 3.3 Login de la administradora

`POST /auth/admin/login` — público

```json
{ "email": "admin@tranquila.pe", "password": "<contraseña>" }
```

Respuesta `200`:

```json
{
  "token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": "8h",
  "administrador": {
    "id": "24326a26-1071-4b95-91ca-37a13df6692a",
    "email": "admin@tranquila.pe",
    "nombres": "Rosa Quispe",
    "tenant_id": "a1000000-0000-4000-8000-000000000001"
  }
}
```

---

## 4. Mapa de pantallas → endpoints (PWA del residente)

| Pantalla (FSD-002) | Endpoint(s) | Notas de UX |
|---|---|---|
| Login (RF-R-01) | `POST /auth/login`, `POST /auth/otp` | Dos pestañas: contraseña / código por WhatsApp |
| Selector de unidades (RF-R-02) | `GET /payer/units` | Si `seleccion_requerida = false` (una sola unidad) saltar directo al dashboard. Conservar la unidad elegida en la sesión. Opción «Todas mis unidades». |
| Dashboard (RF-R-03) | `GET /payer/debts?scope=all` o `?unit_id={id}` | Si `estas_al_dia` → mostrar «Estás al día» y acceso al historial. Destacar `saldo_vencido`. |
| Mis propiedades (RF-R-04) | `GET /payer/properties` | Edificios → tipos → unidades, con subtotales y total general. Botón «Reportar dato incorrecto». |
| Cuotas pendientes (RF-R-05) | `GET /payer/units/{id}/debts` o el array `cuotas` del dashboard | Ya vienen ordenadas por vencimiento. Checkbox solo si `puede_pagar`. Expandir desglose. Botón «Ver aviso PDF». |
| Cuotas pagadas / historial (RF-R-06) | `GET /payer/units/{id}/transactions` o `GET /payer/transactions` | Filtros por año y periodo. KPI «Total histórico pagado». Botón «Descargar comprobante». |
| Checkout (RF-R-07 a RF-R-10) | `POST /payments/checkout`, `GET /payments/{id}/status` | Ver [§6](#6-flujo-de-pago-checkout). |
| Billetera (RF-R-11, RF-R-12) | `GET/POST/PATCH/DELETE /payer/payment-methods` | Tokenizar con el SDK de la pasarela; el backend solo recibe el token. |
| Pago desde WhatsApp (RF-R-14) | `GET /payer/pay-links/{token}` + checkout | Ruta pública `/pagar/{token}` en la PWA. Ver [§7](#7-pago-desde-link-de-whatsapp-rf-r-14). |
| Perfil | `PUT /payer/me/password` | Crear o cambiar contraseña. |

---

## 5. Endpoints del residente

Todos requieren token `PAYER` salvo que se indique. Base: `/api/v1/payer`.

### 5.1 `GET /payer/units` — Selector de unidades (RF-R-02)

Solo unidades con relación activa. Agrupadas por edificio y por tipo (Departamentos → Depósitos → Cocheras).

```json
{
  "total_unidades": 4,
  "seleccion_requerida": true,
  "edificios": [
    {
      "id": "b1000000-0000-4000-8000-000000000001",
      "nombre": "Residencial Los Pinos – Torre A",
      "direccion": "Av. Javier Prado Este 1234, San Isidro",
      "administradora": "Tranquila Administraciones",
      "moneda": "PEN",
      "tipos": [
        {
          "tipo_unidad": "DEPARTAMENTO",
          "etiqueta": "Departamentos",
          "unidades": [
            {
              "id": "c1000000-0000-4000-8000-000000000402",
              "codigo_interno": "DPTO-402",
              "alias": "Dpto 402",
              "tipo_unidad": "DEPARTAMENTO",
              "tipo_etiqueta": "Departamento",
              "descripcion": "Piso 4 · N.° 402 · 85.5 m² · 3 dorm. · Alícuota 1.25 %",
              "metadata": { "tipo": "DEPARTAMENTO", "piso": 4, "numero": "402", "area_m2": 85.5, "alicuota": 1.25, "dormitorios": 3 },
              "roles": ["PROPIETARIO"]
            }
          ]
        },
        {
          "tipo_unidad": "COCHERA",
          "etiqueta": "Cocheras",
          "unidades": [
            {
              "id": "c1000000-0000-4000-8000-000000000007",
              "codigo_interno": "COCH-S2-07",
              "alias": "Cochera 07",
              "tipo_unidad": "COCHERA",
              "tipo_etiqueta": "Cochera",
              "descripcion": "Cochera techada · N.° 07 · Nivel S2 · 12.5 m² · Alícuota 0.3 %",
              "metadata": { "tipo": "COCHERA", "nivel": "S2", "numero": "07", "area_m2": 12.5, "techada": true, "alicuota": 0.3 },
              "roles": ["PROPIETARIO"]
            }
          ]
        }
      ]
    }
  ]
}
```

- `etiqueta`, `tipo_etiqueta` y `descripcion` ya vienen listos para mostrar (vocabulario del rubro).
- `metadata` trae los atributos crudos por si quieres una presentación propia (ver [§9.3](#93-tipos-de-unidad-y-atributos-de-metadata)).
- `roles`: `PROPIETARIO` y/o `INQUILINO`.

### 5.2 `GET /payer/properties` — Mis propiedades (RF-R-04)

Misma agrupación que 5.1, y además estado de cuenta por unidad, subtotal por edificio y total general.

```json
{
  "edificios": [
    {
      "id": "b1000000-0000-4000-8000-000000000001",
      "nombre": "Residencial Los Pinos – Torre A",
      "direccion": "Av. Javier Prado Este 1234, San Isidro",
      "administradora": "Tranquila Administraciones",
      "moneda": "PEN",
      "tipos": [
        {
          "tipo_unidad": "DEPARTAMENTO",
          "etiqueta": "Departamentos",
          "unidades": [
            {
              "id": "c1000000-0000-4000-8000-000000000402",
              "codigo_interno": "DPTO-402",
              "alias": "Dpto 402",
              "tipo_unidad": "DEPARTAMENTO",
              "tipo_etiqueta": "Departamento",
              "descripcion": "Piso 4 · N.° 402 · 85.5 m² · 3 dorm. · Alícuota 1.25 %",
              "metadata": { "piso": 4, "numero": "402", "area_m2": 85.5, "alicuota": 1.25, "dormitorios": 3, "tipo": "DEPARTAMENTO" },
              "roles": ["PROPIETARIO"],
              "estado_cuenta": [
                { "moneda": "PEN", "saldo_pendiente": "550.00", "saldo_vencido": "631.50", "deuda_total": "1181.50", "pago_en_proceso": "0.00" }
              ],
              "ultimo_pago": null
            }
          ]
        }
      ],
      "subtotal": [
        { "moneda": "PEN", "saldo_pendiente": "630.00", "saldo_vencido": "631.50", "deuda_total": "1261.50", "pago_en_proceso": "0.00" }
      ]
    }
  ],
  "total_general": [
    { "moneda": "PEN", "saldo_pendiente": "1030.00", "saldo_vencido": "1051.50", "deuda_total": "2081.50", "pago_en_proceso": "0.00" }
  ]
}
```

- `deuda_total = saldo_pendiente + saldo_vencido`. `pago_en_proceso` **no** es deuda pagable: mostrarlo aparte («pago en proceso»).
- `ultimo_pago`: `null` o `{ "fecha": "2026-10-25T20:02:37.745Z", "monto": "631.50", "codigo_operacion": "TRK-20261025-77DC9034A3" }`.
- `estado_cuenta` vacío (`[]`) = unidad sin deuda abierta.

### 5.3 `GET /payer/debts` — Dashboard de deuda (RF-R-03)

Query: `scope=all` (consolidado, por defecto) o `unit_id={uuid}` (una unidad).

```json
{
  "estas_al_dia": false,
  "mensaje": null,
  "resumen": [
    {
      "moneda": "PEN",
      "saldo_pendiente": "1030.00",
      "saldo_vencido": "1051.50",
      "deuda_total": "2081.50",
      "pago_en_proceso": "0.00",
      "proximo_vencimiento": { "fecha": "2026-11-01", "monto": "300.00", "debt_id": "e9fba01a-a1fc-419b-922a-f7692dc62f53" }
    }
  ],
  "cuotas": [ /* objetos Cuota (ver 5.4), de todas las unidades, ordenadas por vencimiento */ ]
}
```

Si no hay deuda: `estas_al_dia: true` y `mensaje: "Estás al día"`.

### 5.4 `GET /payer/units/{unitId}/debts` — Cuotas de una unidad (RF-R-05)

Query opcional `status`: lista separada por comas. Por defecto `PENDIENTE,VENCIDO,EN_PROCESO`. Ejemplo para ver pagadas: `?status=PAGADO`.

```json
{
  "unidad": {
    "id": "c1000000-0000-4000-8000-000000000012",
    "codigo_interno": "DEP-S1-12",
    "alias": "Depósito 12",
    "tipo_unidad": "DEPOSITO",
    "tipo_etiqueta": "Depósito",
    "descripcion": "N.° 12 · Nivel S1 · 4 m² · Alícuota 0.1 %"
  },
  "cuotas": [
    {
      "id": "59b40fc0-32d1-4cff-baaf-462af10f5c74",
      "unidad": { "id": "c1000000-0000-4000-8000-000000000402", "codigo_interno": "DPTO-402", "alias": "Dpto 402", "tipo_unidad": "DEPARTAMENTO", "tipo_etiqueta": "Departamento", "descripcion": "Piso 4 · N.° 402 · 85.5 m² · 3 dorm. · Alícuota 1.25 %" },
      "edificio": { "id": "b1000000-0000-4000-8000-000000000001", "nombre": "Residencial Los Pinos – Torre A" },
      "periodo": "2026-08",
      "concepto": "Mantenimiento 2026-08",
      "tipo_cuota": "ORDINARIA",
      "tipo_cuota_etiqueta": "Ordinaria",
      "fecha_emision": "2026-08-05",
      "fecha_vencimiento": "2026-08-15",
      "moneda": "PEN",
      "monto_base": "300.00",
      "monto_mora": "20.40",
      "monto_descuento": "0.00",
      "monto_total": "320.40",
      "detalle_items": [
        { "item": "Limpieza", "monto": 80 },
        { "item": "Vigilancia", "monto": 150 },
        { "item": "Agua común", "monto": 45 },
        { "item": "Fondo de reserva", "monto": 25 }
      ],
      "estado": "VENCIDO",
      "estado_etiqueta": "Vencida",
      "puede_pagar": true
    }
  ]
}
```

Reglas de UI:
- El orden ya viene por `fecha_vencimiento` ascendente (vencidas primero). No reordenar.
- En vencidas mostrar `monto_base`, `monto_mora` y `monto_total` por separado.
- `detalle_items` suma `monto_base`.
- Habilitar el checkbox de pago **solo si `puede_pagar` es `true`**. `false` ocurre en cuotas `EN_PROCESO` o cuando el rol no permite pagarla.
- Cuotas `EN_PROCESO`: mostrar «Pago en proceso» (`estado_etiqueta`) y no permitir seleccionarlas.
- Una cuota que no existe o no es visible para el rol responde `404 UNIT_NOT_FOUND` / `DEBT_NOT_FOUND`.

### 5.5 `GET /payer/debts/{debtId}/notice.pdf` — Aviso de cobranza (RF-R-05)

Devuelve `application/pdf`. Como requiere `Authorization`, no sirve un `<a href>` directo:

```ts
async function abrirPdf(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw await res.json();
  const blob = await res.blob();
  window.open(URL.createObjectURL(blob), '_blank');
}
```

### 5.6 Historial de pagos (RF-R-06)

- `GET /payer/units/{unitId}/transactions` — de una unidad.
- `GET /payer/transactions` — consolidado. Acepta `unit_id` opcional.

Query: `year` (ej. `2026`), `periodo` (ej. `2026-09`), `page`, `page_size`.

```json
{
  "total_historico_pagado": [ { "moneda": "PEN", "monto": "631.50" } ],
  "page": 1,
  "page_size": 20,
  "total_registros": 1,
  "pagos": [
    {
      "id": "dc8a1118-2093-4926-98a9-74a116381d5d",
      "codigo_operacion": "TRK-20261025-77DC9034A3",
      "fecha_pago": "2026-10-25T20:02:37.745Z",
      "metodo_pago": "YAPE",
      "moneda": "PEN",
      "monto_total_cobrado": "640.14",
      "monto_aplicado": "631.50",
      "cuotas": [
        { "debt_id": "59b40fc0-...", "periodo": "2026-08", "concepto": "Mantenimiento 2026-08", "codigo_interno": "DPTO-402", "monto_aplicado": "320.40" },
        { "debt_id": "4b1038ff-...", "periodo": "2026-09", "concepto": "Mantenimiento 2026-09", "codigo_interno": "DPTO-402", "monto_aplicado": "311.10" }
      ],
      "estado": "PAGADO",
      "extornos": []
    }
  ]
}
```

- Orden: del más reciente al más antiguo.
- `monto_total_cobrado`: lo que pagó el residente, comisión incluida. `monto_aplicado`: lo que se abonó a las cuotas visibles.
- `estado`: `PAGADO` o `EXTORNADO`. Un pago extornado **no se oculta**: mostrarlo junto a sus movimientos de `extornos` (`id`, `codigo_operacion`, `fecha`, `monto_total_cobrado`, `moneda`). Las cuotas de un pago extornado vuelven a aparecer como pendientes o vencidas.
- Inquilinos: por defecto ven solo los pagos que hicieron ellos (regla configurable por edificio).

### 5.7 `GET /payer/transactions/{transactionId}/receipt.pdf` — Comprobante (RF-R-06)

`application/pdf`, mismo patrón que 5.5. Solo existe para pagos confirmados; si no, `404 RECEIPT_NOT_FOUND`.

### 5.8 `POST /payer/units/{unitId}/data-issues` — Reportar dato incorrecto (RF-R-04)

```json
{ "descripcion": "El área de la cochera es 13 m², no 12.5 m²" }
```

`descripcion`: 5–1000 caracteres. Respuesta `201`:

```json
{ "id": "96ef5fd3-afde-4716-8521-ba85a261e8b0", "estado": "ABIERTO", "created_at": "2026-10-25T20:02:38.296Z" }
```

El residente **no edita** datos de la unidad: este reporte notifica a la administradora.

### 5.9 `PUT /payer/me/password` — Crear o cambiar contraseña

```json
{ "password_actual": "<contraseña-actual>", "password_nueva": "<contraseña-nueva>" }
```

- `password_nueva`: mínimo 8 caracteres.
- `password_actual` es obligatoria solo si el residente ya tiene contraseña (`tiene_password: true`).
- Respuesta `204` sin cuerpo. Error `400 INVALID_PASSWORD` si la actual no coincide.

### 5.10 Billetera de tarjetas (RF-R-11, RF-R-12)

> **PCI-DSS:** el número de tarjeta, la fecha de expiración y el CVV se capturan **solo** con el SDK/formulario seguro de la pasarela en el navegador. Al backend se envía únicamente el `token_id` que devuelve la pasarela, la marca y los últimos 4 dígitos. Si llega algo con forma de número de tarjeta, el backend lo rechaza (`400`).

**Listar** — `GET /payer/payment-methods`

```json
[
  { "id": "aac8e0ef-4789-467a-8747-b9777b7c5647", "pasarela": "mock", "tipo": "CARD", "marca": "VISA", "ultimos_4_digitos": "4242", "es_predeterminado": true, "debito_automatico_activo": false, "created_at": "2026-10-25T20:02:37.916Z" },
  { "id": "9d5b8cd7-98e8-449c-8d6d-9c316eb68b4f", "pasarela": "mock", "tipo": "CARD", "marca": "MASTERCARD", "ultimos_4_digitos": "5454", "es_predeterminado": false, "debito_automatico_activo": true, "created_at": "2026-10-25T20:02:37.947Z" }
]
```

**Agregar** — `POST /payer/payment-methods` → `201` con el objeto creado

```json
{
  "pasarela": "mock",
  "token_id": "tkn_mc_juan_0002",
  "marca": "MASTERCARD",
  "ultimos_4_digitos": "5454",
  "es_predeterminado": false,
  "debito_automatico_activo": true
}
```

`pasarela` es opcional (por defecto `mock` en desarrollo). La primera tarjeta queda como predeterminada automáticamente. Si el token ya existe: `409 PAYMENT_METHOD_EXISTS`.

**Actualizar** — `PATCH /payer/payment-methods/{id}`

```json
{ "es_predeterminado": true }
```

o `{ "debito_automatico_activo": false }`.

**Eliminar** — `DELETE /payer/payment-methods/{id}`

- Si la tarjeta tiene débito automático activo, responde `409 CONFIRMATION_REQUIRED`. Mostrar un diálogo de confirmación y repetir con `?confirmar=true`.
- Respuesta `200`: `{ "id": "...", "eliminado": true, "debito_automatico_desactivado": true }`.
- Las transacciones pasadas no se alteran.

> El interruptor `debito_automatico_activo` ya se guarda, pero los cargos automáticos todavía no se ejecutan (ver [§14](#14-pendiente-en-el-backend)).

---

## 6. Flujo de pago (checkout)

### 6.1 Resumen del flujo (FSD-002 §8.1)

```text
Residente selecciona cuotas (puede_pagar = true)
        │
        ▼
POST /payments/checkout  (Idempotency-Key nuevo por intento)
        │
        ├── 202  estado = EN_PROCESO ──► mostrar «Pago en proceso»
        │          │                     + CIP/QR si metodo = CIP
        │          │                     + abrir 3DS si viene next_action
        │          ▼
        │    polling GET /payments/{id}/status cada 3 s
        │          ├── PAGADO   ──► pantalla de éxito + comprobante
        │          ├── FALLIDO  ──► mostrar motivo_fallo, permitir reintentar
        │          └── EN_PROCESO (timeout del polling) ──► «Te avisaremos por WhatsApp»
        │
        ├── 402 PAYMENT_DECLINED ──► rechazo inmediato (ej. OTP Yape inválido): cuotas liberadas
        └── 409 / 4xx ──► ver tabla de errores
```

> **Regla crítica:** la pantalla de éxito se muestra **solo** cuando `GET /payments/{id}/status` devuelve `estado: "PAGADO"` (confirmado por el webhook de la pasarela). Una redirección o un «éxito» del SDK de la pasarela **no** confirma el pago.

### 6.2 `POST /payments/checkout`

Auth: token `PAYER` o `PAY_LINK`.

**Header obligatorio** `Idempotency-Key`: 16–80 caracteres (`A-Z a-z 0-9 - _`). Reglas:

- Generar uno nuevo (`crypto.randomUUID()`) **cada vez que el usuario pulsa «Pagar»**.
- Si la red falla y reintentas la **misma** petición, reutiliza la **misma** clave: el backend devuelve la misma transacción sin cobrar dos veces.
- Tras un rechazo (`402`) o para cambiar de cuotas o de método, genera una clave **nueva**.
- Reusar una clave con otro cuerpo → `422 IDEMPOTENCY_KEY_REUSED`.

**Body** (nunca enviar montos: el backend los ignora y los recalcula):

| Campo | Tipo | Regla |
|---|---|---|
| `debt_ids` | `uuid[]` | 1 a 24 cuotas, sin repetir, **del mismo edificio y moneda** |
| `metodo_pago` | `YAPE` \| `CARD` \| `CIP` | |
| `yape` | objeto | Obligatorio si `YAPE`: `celular` (9 dígitos, empieza con 9) y `otp` (6 dígitos, el código de aprobación de la app Yape) |
| `card` | objeto | Obligatorio si `CARD`: **o** `payment_method_id` (tarjeta guardada) **o** `token_id` (tarjeta nueva tokenizada). Opcionales con token nuevo: `guardar`, `marca`, `ultimos_4_digitos` |

Ejemplos de body:

```json
{ "debt_ids": ["59b40fc0-...", "4b1038ff-..."], "metodo_pago": "YAPE", "yape": { "celular": "987654321", "otp": "123456" } }
```

```json
{ "debt_ids": ["628f37b3-..."], "metodo_pago": "CARD", "card": { "payment_method_id": "aac8e0ef-4789-467a-8747-b9777b7c5647" } }
```

```json
{ "debt_ids": ["628f37b3-..."], "metodo_pago": "CARD", "card": { "token_id": "tkn_xxx_de_la_pasarela", "guardar": true, "marca": "VISA", "ultimos_4_digitos": "4242" } }
```

```json
{ "debt_ids": ["3a9b1dca-..."], "metodo_pago": "CIP" }
```

**Respuesta `202 Accepted`** (Yape, dos cuotas):

```json
{
  "transaction_id": "dc8a1118-2093-4926-98a9-74a116381d5d",
  "codigo_operacion": "TRK-20261025-77DC9034A3",
  "estado": "EN_PROCESO",
  "metodo_pago": "YAPE",
  "moneda": "PEN",
  "monto_total": "640.14",
  "resumen": {
    "cuotas": [
      { "id": "59b40fc0-...", "periodo": "2026-08", "concepto": "Mantenimiento 2026-08", "estado_cuota": "EN_PROCESO", "monto_aplicado": "320.40", "codigo_interno": "DPTO-402" },
      { "id": "4b1038ff-...", "periodo": "2026-09", "concepto": "Mantenimiento 2026-09", "estado_cuota": "EN_PROCESO", "monto_aplicado": "311.10", "codigo_interno": "DPTO-402" }
    ],
    "subtotal": "631.50",
    "comision_recaudadora": "7.32",
    "igv_comision": "1.32",
    "comision_pasarela": "0.00",
    "comision_asumida_por": "PAGADOR",
    "monto_total": "640.14"
  },
  "expira_en": "2026-10-25T20:32:37.681Z",
  "fecha_pago": null,
  "motivo_fallo": null
}
```

Pantalla de resumen: mostrar cuotas, `subtotal` y, **si `comision_asumida_por` es `PAGADOR`**, la comisión de servicio (`comision_recaudadora`), su IGV (`igv_comision`) y la comisión de pasarela si es mayor que 0. Total = `monto_total`. Si la comisión la asume la administradora (`TENANT`), el residente paga solo el subtotal.

> Hoy el resumen se conoce al crear el intento. Si el diseño necesita mostrar la comisión **antes** de que el usuario confirme, pídanlo al backend: se puede agregar un endpoint de cotización sin crear el pago.

**Extras según método:**

CIP (`metodo_pago: "CIP"`): mostrar código, QR y vencimiento (24 h). La cuota queda reservada como «pago en proceso» mientras el CIP esté vigente.

```json
"cip": { "codigo": "493111156", "qr": "MOCKQR|493111156|31.53|PEN", "expira_en": "2026-10-26T20:02:37.886Z" }
```

Tarjeta con 3DS: si viene `next_action`, abrir el desafío 3DS con el SDK de la pasarela (en el mock es una URL ficticia). Después, seguir con el polling.

```json
"next_action": { "type": "3DS", "url": "https://mock-gateway.local/3ds/mock_chg_a5e2b3d3d365030a" }
```

### 6.3 `GET /payments/{transactionId}/status` — Polling

Auth: `PAYER` o `PAY_LINK` (el mismo pagador que inició el pago). Devuelve el mismo objeto que el checkout, con `estado` actualizado:

| `estado` | Significado | UI |
|---|---|---|
| `EN_PROCESO` | Esperando confirmación de la pasarela | Spinner «Estamos confirmando tu pago». Seguir consultando. |
| `PAGADO` | Confirmado por webhook | Pantalla de éxito, `fecha_pago`, botón de comprobante (`/payer/transactions/{id}/receipt.pdf`) |
| `FALLIDO` | Rechazado o expirado (`motivo_fallo`) | Mostrar motivo y permitir reintentar con una clave nueva |
| `EXTORNADO` | Pago revertido por backoffice | Informativo |

Recomendación de polling: cada 3 s durante 2 min para Yape y tarjeta. Si sigue `EN_PROCESO`, mostrar «Te avisaremos por WhatsApp cuando se confirme» y dejar de consultar. Para CIP no hacer polling largo: el residente paga más tarde.

### 6.4 Errores del checkout

| HTTP | code | Qué hacer en el front |
|---|---|---|
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | Bug del front: falta el header |
| 400 | `VALIDATION_ERROR` | Marcar campos (ej. OTP Yape de 5 dígitos, celular inválido, número de tarjeta en lugar de token) |
| 402 | `PAYMENT_DECLINED` | Mostrar `message` (ej. «Código de aprobación de Yape rechazado»). Las cuotas ya fueron liberadas: reintentar con una clave nueva. `details.transaction_id` disponible. |
| 403 | `DEBT_NOT_PAYABLE_BY_ROLE` | «Tu rol en esta unidad no permite pagar esta cuota» |
| 403 | `PAY_LINK_SCOPE` | Con token de link: se intentó pagar otra cuota o usar o guardar tarjetas |
| 404 | `DEBT_NOT_FOUND` / `PAYMENT_METHOD_NOT_FOUND` | Refrescar la lista de cuotas o tarjetas |
| 409 | `DEBT_IN_PROCESS` | «Esta cuota tiene un pago en proceso» (otro miembro de la unidad la está pagando o hay un CIP vigente). Refrescar. |
| 409 | `DEBT_ALREADY_PAID` | Refrescar: ya está pagada |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | Clave usada por otro usuario: generar una nueva |
| 410 | `PAY_LINK_EXPIRED` | Link vencido o usado: pedir login |
| 422 | `MIXED_CHECKOUT` | «Solo puedes pagar juntas cuotas del mismo edificio y moneda». Sugerencia de UX: no permitir esa selección. |
| 422 | `IDEMPOTENCY_KEY_REUSED` | Bug del front: generar clave nueva |
| 429 | `RATE_LIMITED` | Esperar |

---

## 7. Pago desde link de WhatsApp (RF-R-14)

El residente recibe por WhatsApp un link `{PAY_LINK_BASE_URL}{token}` (en desarrollo: `http://localhost:5173/pagar/{token}`). La PWA debe tener la ruta pública `/pagar/:token`.

1. La PWA llama `GET /api/v1/payer/pay-links/{token}`, sin auth.
2. Con la respuesta muestra la cuota y los métodos de pago, sin pedir login.
3. Usa `checkout_token` como `Authorization: Bearer ...` en `POST /payments/checkout` y `GET /payments/{id}/status`.

Respuesta `200`:

```json
{
  "checkout_token": "eyJhbGciOi...",
  "checkout_token_expira_en_minutos": 15,
  "pagador": { "nombres": "Carla" },
  "cuota": { /* objeto Cuota completo (5.4) */ },
  "metodos_pago": ["YAPE", "CARD", "CIP"]
}
```

Restricciones del token de link:
- Solo paga **esa** cuota (`debt_ids` debe ser exactamente `[cuota.id]`).
- Con tarjeta solo se admite un `token_id` nuevo y sin `guardar`. Las tarjetas guardadas requieren login completo.
- No da acceso a otras pantallas: unidades, historial o billetera responden `403`. Para eso, ofrecer «Ingresar a Tranky».
- Vence a los 15 minutos. Si vence, volver a llamar a `GET /pay-links/{token}`; el link en sí dura 72 h.

Errores:

| HTTP | code | UI |
|---|---|---|
| 410 | `PAY_LINK_EXPIRED` | «El link expiró o ya fue usado» + botones «Iniciar sesión» / «Solicitar nuevo link» |
| 409 | `DEBT_ALREADY_PAID` | «Esta cuota ya fue pagada» |

Para generar links de prueba ver [§11](#11-herramientas-de-desarrollo-pasarela-simulada).

---

## 8. Endpoints del portal de la administradora (B2B)

Todos requieren token `TENANT_ADMIN`. Base: `/api/v1/tenant`. Cada administradora solo ve los datos de su propio tenant; un ID de otra administradora responde `404`.

### 8.1 Edificios

**`GET /tenant/organization-units`**

```json
[
  {
    "id": "b1000000-0000-4000-8000-000000000001",
    "tenant_id": "a1000000-0000-4000-8000-000000000001",
    "nombre": "Residencial Los Pinos – Torre A",
    "direccion": "Av. Javier Prado Este 1234, San Isidro",
    "moneda_base": "PEN",
    "bank_account_id": "2b1640d1-f4bd-4fbe-9a67-674fd9f4a155",
    "config_json": { "mora": { "tipo": "INTERES_DIARIO", "valor": 0.1, "dias_gracia": 3, "tope": 50 } },
    "activo": true,
    "created_at": "2026-10-25T20:02:35.896Z",
    "updated_at": "2026-10-25T20:02:35.896Z",
    "total_unidades": 4
  }
]
```

**`POST /tenant/organization-units`** → `201`

```json
{ "nombre": "Torre B", "direccion": "Av. Siempre Viva 742", "moneda_base": "PEN", "config_json": {} }
```

**`PATCH /tenant/organization-units/{id}`**: `nombre`, `direccion` y/o `config_json`. `config_json` se fusiona con la configuración actual.

Configuración por edificio (`config_json`), todo opcional:

```json
{
  "mora": { "tipo": "INTERES_DIARIO", "valor": 0.1, "dias_gracia": 3, "tope": 50 },
  "permisos_cuota": {
    "PROPIETARIO": { "ver": ["ORDINARIA", "EXTRAORDINARIA"], "pagar": ["ORDINARIA", "EXTRAORDINARIA"], "historial": "UNIDAD" },
    "INQUILINO": { "ver": ["ORDINARIA"], "pagar": ["ORDINARIA"], "historial": "PROPIOS" }
  }
}
```

| Campo | Valores |
|---|---|
| `mora.tipo` | `NINGUNA` (por defecto) · `PENALIDAD_FIJA` (monto único en moneda del edificio) · `INTERES_DIARIO` (`valor` = % diario sobre el monto base) |
| `mora.dias_gracia` | Días después del vencimiento sin mora |
| `mora.tope` | Mora máxima (monto) o `null` |
| `permisos_cuota.{ROL}.historial` | `UNIDAD` (ve todos los pagos de la unidad) o `PROPIOS` (solo los suyos) |

Los valores por defecto son los del ejemplo (FSD-002 §4.1, decisiones P-01 a P-03 por validar).

### 8.2 Unidades

**`GET /tenant/units`** — query opcional `organization_unit_id`, `tipo_unidad`.

```json
[
  {
    "id": "c1000000-0000-4000-8000-000000000007",
    "tenant_id": "a1000000-0000-4000-8000-000000000001",
    "organization_unit_id": "b1000000-0000-4000-8000-000000000001",
    "tipo_unidad": "COCHERA",
    "codigo_interno": "COCH-S2-07",
    "alias": "Cochera 07",
    "metadata_json": { "tipo": "COCHERA", "nivel": "S2", "numero": "07", "area_m2": 12.5, "techada": true, "alicuota": 0.3 },
    "activo": true,
    "created_at": "2026-10-25T20:02:35.896Z",
    "updated_at": "2026-10-25T20:02:35.896Z",
    "edificio": "Residencial Los Pinos – Torre A",
    "residentes": [
      { "relacion_id": "6cd7d0ad-...", "payer_id": "d0000000-0000-4000-8000-000000000001", "rol": "PROPIETARIO", "tipo_doc": "DNI", "num_doc": "45678901", "nombres": "Juan", "apellidos": "Pérez Salas" }
    ],
    "tipo_etiqueta": "Cochera",
    "descripcion": "Cochera techada · N.° 07 · Nivel S2 · 12.5 m² · Alícuota 0.3 %"
  }
]
```

**`POST /tenant/units`** → `201`

```json
{
  "organization_unit_id": "b1000000-0000-4000-8000-000000000001",
  "tipo_unidad": "COCHERA",
  "codigo_interno": "COCH-S2-08",
  "alias": "Cochera 08",
  "metadata_json": { "nivel": "S2", "numero": "08", "techada": false, "area_m2": 12.5, "alicuota": 0.3 }
}
```

Errores: `422 TIPO_UNIDAD_INVALIDO`, `422 METADATA_INVALIDA` (con `details`), `409 CONFLICT` (código repetido en el edificio).

**`PATCH /tenant/units/{id}`**: `tipo_unidad`, `alias`, `metadata_json` (se fusiona) y/o `activo` (`false` = baja lógica).

### 8.3 Residentes y vínculos

**`GET /tenant/payers`** — residentes con vínculos en el tenant, activos e inactivos.

```json
[
  {
    "id": "d0000000-0000-4000-8000-000000000002",
    "tipo_doc": "DNI",
    "num_doc": "41234567",
    "nombres": "María",
    "apellidos": "Torres Vega",
    "email": "maria.torres@example.com",
    "telefono_whatsapp": "51912345678",
    "unidades": [
      { "relacion_id": "4ba60572-...", "billing_unit_id": "c1000000-0000-4000-8000-000000000402", "codigo_interno": "DPTO-402", "rol": "INQUILINO", "activo": true }
    ]
  }
]
```

**`POST /tenant/unit-relations`** → `201`: vincula un residente a una unidad. Se envía `payer_id` (existente) **o** `pagador` (se crea o reutiliza por documento):

```json
{
  "billing_unit_id": "c1000000-0000-4000-8000-000000000501",
  "rol": "INQUILINO",
  "pagador": { "tipo_doc": "DNI", "num_doc": "48887776", "nombres": "Pedro", "apellidos": "Salazar Ruiz", "email": "pedro@example.com", "telefono_whatsapp": "976543210" }
}
```

`telefono_whatsapp`: 9 dígitos (se guarda como `51XXXXXXXXX`). Error `409 RELATION_EXISTS` si ya tiene ese rol activo.

**`POST /tenant/unit-relations/{relacionId}/deactivate`**: fin de arrendamiento o baja. No borra el historial.

### 8.4 Importación masiva del padrón (.xlsx) (RF-S-02)

- **Plantilla:** `GET /tenant/units/bulk-import/template` descarga el `.xlsx` con columnas y filas de ejemplo.
- **Carga:** `POST /tenant/units/bulk-import?organization_unit_id={id}&modo=validar|confirmar`. Es `multipart/form-data` con el archivo en el campo **`archivo`** (máx. 5 MB, 5000 filas).

```ts
const form = new FormData();
form.append('archivo', file);
await fetch(`${API}/tenant/units/bulk-import?organization_unit_id=${id}&modo=validar`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` }, // no poner Content-Type: el navegador arma el boundary
  body: form,
});
```

Flujo sugerido: primero `modo=validar` y mostrar la tabla de errores por fila; si `valido` es `true`, botón «Confirmar importación» con `modo=confirmar`. Es todo o nada: con un solo error no se aplica nada.

Columnas: `codigo_interno`*, `tipo_unidad`*, `alias`, `piso`, `numero`, `nivel`, `area_m2`, `alicuota`, `techada` (SI/NO), `dormitorios`, `rol`, `tipo_doc`, `num_doc`, `nombres`, `apellidos`, `email`, `telefono_whatsapp`. Una fila = una unidad + opcionalmente un residente; para dos residentes en la misma unidad, repetir el código en otra fila.

Respuesta (`200` si es válido, `422` si hay errores):

```json
{
  "modo": "CONFIRMAR",
  "valido": false,
  "resumen": { "filas_leidas": 2, "unidades_nuevas": 1, "unidades_existentes": 0, "pagadores_nuevos": 0, "relaciones": 0 },
  "errores": [
    { "fila": 2, "campo": "num_doc", "mensaje": "Número de DNI inválido" },
    { "fila": 2, "campo": "email", "mensaje": "Correo electrónico inválido" },
    { "fila": 3, "campo": "tipo_unidad", "mensaje": "Tipo no reconocido. Válidos: DEPARTAMENTO, DEPOSITO, COCHERA" }
  ],
  "advertencias": [],
  "aplicado": false
}
```

`advertencias` no bloquea la importación (ej. un documento ya registrado con otro nombre: se conserva el existente).

### 8.5 Emisión masiva de cuotas (RF-S-03)

**`POST /tenant/debts/generate`** → `201`

```json
{
  "organization_unit_id": "b1000000-0000-4000-8000-000000000001",
  "periodo": "2026-11",
  "concepto_principal": "Mantenimiento 2026-11",
  "tipo_cuota": "ORDINARIA",
  "fecha_emision": "2026-11-01",
  "fecha_vencimiento": "2026-11-30",
  "modo_calculo": "ALICUOTA",
  "tipos_unidad": ["DEPARTAMENTO"],
  "items": [{ "item": "Gastos comunes", "monto": 20000 }],
  "enviar_avisos": true
}
```

| Campo | Regla |
|---|---|
| `modo_calculo` | `MONTO_FIJO`: cada unidad paga los `items` tal cual. `ALICUOTA`: los `items` son totales del edificio y se prorratean por `metadata_json.alicuota` (%); las unidades sin alícuota dan `422 MISSING_ALICUOTA`. |
| `tipos_unidad` / `billing_unit_ids` | Filtros opcionales. Sin filtro = todas las unidades activas del edificio. Para una cuota extraordinaria de una sola unidad usar `billing_unit_ids`. |
| `tipo_cuota` | `ORDINARIA` (por defecto) o `EXTRAORDINARIA` |
| `enviar_avisos` | Encola avisos por WhatsApp/email con link de pago a los residentes que pueden pagar esa cuota |

Respuesta (idempotente: repetir la misma emisión no duplica):

```json
{ "unidades_evaluadas": 2, "cuotas_creadas": 2, "cuotas_omitidas_por_existir": 0, "avisos_encolados": 6 }
```

### 8.6 Monitor de cobranza (RF-S-05)

**`GET /tenant/debts`** — query: `organization_unit_id`, `periodo`, `estado`, `page`, `page_size`.

```json
{
  "page": 1, "page_size": 2, "total_registros": 2,
  "cuotas": [
    {
      "id": "734abe48-2f35-4f35-a917-d41f22b0773d", "periodo": "2026-11", "concepto_principal": "Mantenimiento 2026-11",
      "tipo_cuota": "ORDINARIA", "moneda": "PEN", "fecha_vencimiento": "2026-11-30",
      "monto_base": "250.00", "monto_mora": "0.00", "monto_total": "250.00", "estado": "PENDIENTE",
      "billing_unit_id": "c1000000-0000-4000-8000-000000000402", "codigo_interno": "DPTO-402",
      "tipo_unidad": "DEPARTAMENTO", "edificio": "Residencial Los Pinos – Torre A"
    }
  ]
}
```

**`GET /tenant/transactions`** — query: `organization_unit_id`, `estado` (`INICIADO`, `EXITOSO`, `FALLIDO`, `REVERSADO`), `page`, `page_size`.

```json
{
  "page": 1, "page_size": 1, "total_registros": 1,
  "transacciones": [
    {
      "id": "dc8a1118-...", "codigo_operacion": "TRK-20261025-77DC9034A3", "tipo_asiento": "CARGO", "estado": "EXITOSO",
      "metodo_pago": "YAPE", "pasarela": "mock", "moneda": "PEN",
      "monto_deuda_cubierta": "631.50", "comision_pasarela": "0.00", "comision_recaudadora": "7.32", "igv_comision": "1.32",
      "monto_total_cobrado": "640.14", "monto_neto_a_liquidar": "631.50", "comision_asumida_por": "PAGADOR",
      "fecha_pago": "2026-10-25T20:02:37.745Z", "settlement_id": null, "created_at": "2026-10-25T20:02:37.681Z",
      "pagador": "Juan Pérez Salas", "edificio": "Residencial Los Pinos – Torre A"
    }
  ]
}
```

En el portal B2B los estados de pago llegan con los nombres internos: `INICIADO` equivale a «en proceso» y `REVERSADO` a «extornado».

**`GET /tenant/dashboard/kpis`** — query: `organization_unit_id`, `periodo` (ambos opcionales).

```json
{
  "filtros": { "organization_unit_id": "b1000000-0000-4000-8000-000000000001", "periodo": null },
  "kpis": [
    {
      "moneda": "PEN",
      "cuotas_emitidas": 9,
      "total_emitido": "2091.50",
      "total_recaudado": "631.50",
      "efectividad_cobranza_pct": 30.19,
      "total_pendiente": "1380.00",
      "total_en_mora": "0.00",
      "recargos_mora": "0.00",
      "cuotas_vencidas": 0,
      "pago_en_proceso": "80.00",
      "neto_por_liquidar": "631.50"
    }
  ]
}
```

`efectividad_cobranza_pct` es un número (porcentaje con 2 decimales). `total_en_mora` = monto total de cuotas vencidas; `recargos_mora` = solo la mora.

**`GET /tenant/data-issues`** — query `estado` (`ABIERTO`, `RESUELTO`). Reportes de datos incorrectos enviados por residentes.

```json
[
  { "id": "96ef5fd3-...", "descripcion": "El área de la cochera es 13 m², no 12.5 m²", "estado": "ABIERTO", "created_at": "2026-10-25T20:02:38.296Z", "codigo_interno": "COCH-S2-07", "edificio": "Residencial Los Pinos – Torre A", "reportado_por": "Juan Pérez Salas" }
]
```

**`GET /tenant/settlements`** — liquidaciones a la junta. Hoy devuelve `[]` porque el motor de liquidación aún no está implementado.

---

## 9. Catálogos y enumeraciones

### 9.1 Estados de la cuota

| `estado` | `estado_etiqueta` | Pagable | Descripción |
|---|---|---|---|
| `PENDIENTE` | Pendiente | Sí | Emitida, dentro de plazo |
| `VENCIDO` | Vencida | Sí | Pasó la fecha de vencimiento; puede tener mora |
| `EN_PROCESO` | Pago en proceso | No | Reservada por un intento de pago (cargo enviado, CIP vigente o 3DS pendiente). No suma como deuda pagable. |
| `PAGADO` | Pagada | No | Confirmada por webhook |
| `ANULADO` | Anulada | No | Anulada por la administradora |

### 9.2 Estados del pago (vista del residente)

`EN_PROCESO` · `PAGADO` · `FALLIDO` · `EXTORNADO` (ver [§6.3](#63-get-paymentstransactionidstatus--polling)).

### 9.3 Tipos de unidad y atributos de metadata

| `tipo_unidad` | Etiqueta | Atributos posibles en `metadata` |
|---|---|---|
| `DEPARTAMENTO` | Departamento / Departamentos | `piso` (int), `numero` (string), `area_m2` (number), `alicuota` (0–100), `dormitorios` (int), `unidad_principal_id` (uuid) |
| `DEPOSITO` | Depósito / Depósitos | `nivel` (string, ej. `S1`), `numero`, `area_m2`, `alicuota`, `unidad_principal_id` |
| `COCHERA` | Cochera / Cocheras | `nivel`, `numero`, `techada` (boolean → «Cochera techada»), `area_m2`, `alicuota`, `unidad_principal_id` |

Todos los atributos son opcionales. `unidad_principal_id` (opcional) vincula un depósito o cochera a su departamento solo para presentación.

### 9.4 Otros

| Enumeración | Valores |
|---|---|
| `tipo_cuota` | `ORDINARIA` (Ordinaria), `EXTRAORDINARIA` (Extraordinaria) |
| `roles` | `PROPIETARIO`, `INQUILINO` |
| `metodo_pago` | `YAPE`, `CARD` (tarjeta), `CIP` (código CIP / QR) |
| `tipo_doc` | `DNI`, `CE`, `RUC` |
| `moneda` | `PEN`, `USD` |
| `comision_asumida_por` | `PAGADOR` (se suma al total del residente), `TENANT` (la asume la administradora) |

---

## 10. Códigos de error

| HTTP | code | Contexto |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo o query inválidos (`details` por campo) |
| 400 | `INVALID_JSON` | JSON mal formado |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | Checkout sin header `Idempotency-Key` |
| 400 | `INVALID_PASSWORD` | Contraseña actual incorrecta |
| 400 | `FILE_REQUIRED` / `INVALID_FILE` / `INVALID_TEMPLATE` / `TOO_MANY_ROWS` | Importación `.xlsx` |
| 401 | `UNAUTHORIZED` | Falta el token, o es inválido o expiró → ir a login |
| 401 | `INVALID_CREDENTIALS` | Login fallido |
| 401 | `OTP_INVALID` | OTP inválido, vencido o usado |
| 402 | `PAYMENT_DECLINED` | La pasarela rechazó el pago |
| 403 | `FORBIDDEN` | El tipo de token no corresponde a la ruta |
| 403 | `DEBT_NOT_PAYABLE_BY_ROLE` | El rol no permite pagar la cuota |
| 403 | `PAY_LINK_SCOPE` | Uso indebido del token de link |
| 404 | `NOT_FOUND`, `UNIT_NOT_FOUND`, `DEBT_NOT_FOUND`, `TRANSACTION_NOT_FOUND`, `RECEIPT_NOT_FOUND`, `PAYMENT_METHOD_NOT_FOUND`, `ORGANIZATION_UNIT_NOT_FOUND`, `PAYER_NOT_FOUND`, `RELATION_NOT_FOUND` | Recurso inexistente o no visible para el usuario |
| 409 | `DEBT_IN_PROCESS` | Cuota con pago en proceso |
| 409 | `DEBT_ALREADY_PAID`, `DEBT_ANNULLED` | La cuota ya no es pagable |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | Clave usada por otro usuario |
| 409 | `CONFIRMATION_REQUIRED` | Eliminar tarjeta con débito automático: repetir con `?confirmar=true` |
| 409 | `PAYMENT_METHOD_EXISTS`, `RELATION_EXISTS`, `CONFLICT` | Duplicados |
| 410 | `PAY_LINK_EXPIRED` | Link de pago vencido o usado |
| 422 | `MIXED_CHECKOUT` | Cuotas de distinto edificio o moneda |
| 422 | `IDEMPOTENCY_KEY_REUSED` | Misma clave con otro cuerpo |
| 422 | `PAYMENT_METHOD_GATEWAY_MISMATCH`, `COMMISSION_EXCEEDS_DEBT` | Configuración de pago inconsistente |
| 422 | `TIPO_UNIDAD_INVALIDO`, `METADATA_INVALIDA`, `TIPO_CUOTA_INVALIDO`, `NO_UNITS`, `MISSING_ALICUOTA` | Portal B2B |
| 429 | `RATE_LIMITED`, `ACCOUNT_LOCKED` | Límite de intentos |
| 500 | `INTERNAL_ERROR` | Error inesperado: mostrar mensaje genérico y el `X-Correlation-Id` |

---

## 11. Herramientas de desarrollo (pasarela simulada)

En desarrollo todos los pagos pasan por una **pasarela simulada (`mock`)**. Nadie envía webhooks automáticamente: hay que simularlos. Estas rutas **no existen en producción** y no requieren auth.

### 11.1 Confirmar o rechazar un pago

`POST /api/v1/dev/mock-gateway/transactions/{transactionId}/succeed`
`POST /api/v1/dev/mock-gateway/transactions/{transactionId}/fail` (body opcional `{ "motivo": "Fondos insuficientes" }`)

Simula el webhook firmado de la pasarela. Después, el polling de `GET /payments/{id}/status` devuelve `PAGADO` o `FALLIDO`.

```json
{
  "webhook": { "id": "mock_evt_ba25abc1ce8db1c5", "type": "charge.succeeded", "created": 1792958557, "data": { "charge_id": "mock_chg_3bab19fdf3040bd7", "reference": "dc8a1118-2093-4926-98a9-74a116381d5d", "amount": 64014, "currency": "PEN" } },
  "resultado": { "recibido": true, "resultado": "APLICADO" }
}
```

### 11.2 Generar un link de pago de WhatsApp

`POST /api/v1/dev/pay-links`

```json
{ "debt_id": "7bb83721-6369-4cb8-a690-7b40e9fff82f", "payer_id": "d0000000-0000-4000-8000-000000000003" }
```

Respuesta `201`:

```json
{ "id": "05762a3f-...", "url": "http://localhost:5173/pagar/x_3Mi4k4WS_mO13wW9htnE_LWmSfn0a60g0_zWh9EbE", "expira_en": "2026-10-28T20:02:38.264Z", "token": "x_3Mi4k4WS_mO13wW9htnE_LWmSfn0a60g0_zWh9EbE" }
```

### 11.3 Ejecutar jobs a demanda

`POST /api/v1/dev/jobs/{job}` con `job` = `mora` (recalcula vencimientos y mora), `expiracion` (libera pagos o CIP vencidos) o `notificaciones` (envía los avisos encolados; en desarrollo se imprimen en el log del backend).

### 11.4 Comportamiento de la pasarela simulada

| Método | Entrada | Resultado |
|---|---|---|
| Yape | OTP `000000` | Rechazo inmediato `402 PAYMENT_DECLINED` |
| Yape | Cualquier otro OTP de 6 dígitos | `202`, queda `EN_PROCESO` hasta simular el webhook |
| Tarjeta | `token_id` que empieza con `tkn_rechazo` | Rechazo inmediato `402` |
| Tarjeta | `token_id` que empieza con `tkn_3ds` | `202` con `next_action` 3DS |
| Tarjeta | Cualquier otro token de 8+ caracteres | `202`, `EN_PROCESO` |
| CIP | — | `202` con `cip.codigo` (9 dígitos), `cip.qr` y vencimiento de 24 h |

Plazos: un intento con Yape o tarjeta sin confirmar se libera a los 30 minutos; un CIP, a las 24 horas.

En desarrollo no hay SDK real de pasarela: inventen tokens (`tkn_...`) en el formulario de tarjeta. Cuando se integre Culqi, Niubiz o Izipay, el formulario usará su SDK y enviará el token que devuelva.

---

## 12. Reglas no negociables para el frontend

Derivadas de FSD-002 §12 y §13:

1. **El pago solo está confirmado cuando la API dice `PAGADO`.** Nunca mostrar éxito por una redirección o un callback del SDK de la pasarela.
2. **Nunca enviar ni calcular montos a cobrar.** El backend recalcula todo; mostrar lo que devuelve.
3. **Datos de tarjeta solo en el SDK de la pasarela.** No pasar el número de tarjeta, la fecha ni el CVV por estado propio, logs, analytics ni la API.
4. **Un `Idempotency-Key` nuevo por intento de pago**, reutilizado solo en reintentos de red de la misma petición.
5. **No mezclar monedas**: los totales vienen por moneda; mostrar un total por cada una.
6. **Mobile-first y ligera**: el pago desde el link de WhatsApp debe completarse en unos 15 segundos, sin instalar nada.
7. **Español (Perú)**: montos como `S/ 1,234.50` y `US$ 20.00`; vocabulario del rubro (departamento, depósito, cochera, cuota de mantenimiento).
8. **El residente no edita el padrón**: solo puede «Reportar dato incorrecto».
9. **Mostrar siempre los extornos** en el historial, vinculados al pago original.

---

## 13. Tipos TypeScript sugeridos

```ts
export type Moneda = 'PEN' | 'USD';
export type Monto = string; // "123.45"
export type EstadoCuota = 'PENDIENTE' | 'VENCIDO' | 'EN_PROCESO' | 'PAGADO' | 'ANULADO';
export type EstadoPago = 'EN_PROCESO' | 'PAGADO' | 'FALLIDO' | 'EXTORNADO';
export type MetodoPago = 'YAPE' | 'CARD' | 'CIP';
export type TipoUnidad = 'DEPARTAMENTO' | 'DEPOSITO' | 'COCHERA';
export type Rol = 'PROPIETARIO' | 'INQUILINO';

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface UnidadResumen {
  id: string;
  codigo_interno: string;
  alias: string | null;
  tipo_unidad: TipoUnidad;
  tipo_etiqueta: string;
  descripcion: string;
}

export interface Unidad extends UnidadResumen {
  metadata: Record<string, unknown>;
  roles: Rol[];
}

export interface EstadoCuenta {
  moneda: Moneda;
  saldo_pendiente: Monto;
  saldo_vencido: Monto;
  deuda_total: Monto;
  pago_en_proceso: Monto;
}

export interface Edificio<U = Unidad> {
  id: string;
  nombre: string;
  direccion: string | null;
  administradora: string;
  moneda: Moneda;
  tipos: { tipo_unidad: TipoUnidad; etiqueta: string; unidades: U[] }[];
}

export interface UnidadConSaldo extends Unidad {
  estado_cuenta: EstadoCuenta[];
  ultimo_pago: { fecha: string; monto: Monto; codigo_operacion: string } | null;
}

export interface Cuota {
  id: string;
  unidad: UnidadResumen;
  edificio: { id: string; nombre: string };
  periodo: string;
  concepto: string;
  tipo_cuota: 'ORDINARIA' | 'EXTRAORDINARIA';
  tipo_cuota_etiqueta: string;
  fecha_emision: string;
  fecha_vencimiento: string;
  moneda: Moneda;
  monto_base: Monto;
  monto_mora: Monto;
  monto_descuento: Monto;
  monto_total: Monto;
  detalle_items: { item: string; monto: number }[];
  estado: EstadoCuota;
  estado_etiqueta: string;
  puede_pagar: boolean;
}

export interface CheckoutRequest {
  debt_ids: string[];
  metodo_pago: MetodoPago;
  yape?: { celular: string; otp: string };
  card?: { payment_method_id?: string; token_id?: string; guardar?: boolean; marca?: string; ultimos_4_digitos?: string };
}

export interface Pago {
  transaction_id: string;
  codigo_operacion: string;
  estado: EstadoPago;
  metodo_pago: MetodoPago;
  moneda: Moneda;
  monto_total: Monto;
  resumen: {
    cuotas: { id: string; periodo: string; concepto: string; estado_cuota: EstadoCuota; monto_aplicado: Monto; codigo_interno: string }[];
    subtotal: Monto;
    comision_recaudadora: Monto;
    igv_comision: Monto;
    comision_pasarela: Monto;
    comision_asumida_por: 'PAGADOR' | 'TENANT';
    monto_total: Monto;
  };
  expira_en: string | null;
  fecha_pago: string | null;
  motivo_fallo: string | null;
  cip?: { codigo: string; qr: string; expira_en: string };
  next_action?: { type: '3DS'; url: string };
}

export interface MedioPago {
  id: string;
  pasarela: string;
  tipo: 'CARD';
  marca: string | null;
  ultimos_4_digitos: string;
  es_predeterminado: boolean;
  debito_automatico_activo: boolean;
  created_at: string;
}
```

---

## 14. Pendiente en el backend

Para planificar el frontend en paralelo:

| Funcionalidad | Estado | Impacto en el front |
|---|---|---|
| Pasarelas reales (Culqi / Niubiz / Izipay / Yape) | Pendiente; hoy solo `mock` | Diseñar el formulario de tarjeta pensando en el SDK de la pasarela; el contrato de la API no cambia |
| Ejecución del débito automático | Pendiente; el interruptor se guarda | La UI de activación puede construirse ya |
| Envío real de WhatsApp, SMS y email | Pendiente; hoy se imprime en el log | Sin impacto |
| Liquidaciones a la junta (settlements) | Pendiente; `GET /tenant/settlements` devuelve `[]` | Pantalla B2B de liquidaciones en espera |
| Extornos desde backoffice | Pendiente | El historial ya soporta `EXTORNADO` y `extornos` |
| Cotización previa al checkout | No existe | Si el diseño muestra la comisión antes de confirmar, pedir el endpoint |
