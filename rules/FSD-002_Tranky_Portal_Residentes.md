# DOCUMENTO DE ESPECIFICACIÓN FUNCIONAL — FSD-002
**Tranky – Portal de Residentes de Edificios**
Pago de cuotas de mantenimiento, cuotas pagadas y pendientes, y registro de propiedades.
Vertical inmobiliario (juntas de propietarios y administradoras de edificios – Perú).

- **Derivado de:** FSD-001 v1.0 – Plataforma Multi-Rubro de Recaudación y Cobranzas
- **Autor / Cliente:** Pedro Coronado
- **Versión:** 1.1 (borrador) – 25 de octubre de 2026
- **Clasificación:** Confidencial – uso interno del proyecto

> Transcripción a markdown del PDF `FSD-002_Portal_Residentes_Edificios.pdf`. Es la única guía funcional del backend de Tranky.

---

## 1. Control del documento

| Atributo | Valor |
|---|---|
| Código | FSD-002 |
| Título | Tranky – Portal de Residentes de Edificios (pago de cuotas de mantenimiento) |
| Aplicación | Tranky: app vertical del rubro inmobiliario sobre la Plataforma Multi-Rubro de Recaudación (FSD-001) |
| Versión | 1.1 (borrador) |
| Fecha | 25-oct-2026 |
| Documento base | FSD-001 v1.0 – Plataforma Multi-Rubro de Recaudación y Cobranzas (SaaS multi-tenant, Pay-in / Pay-out) |
| Estado | Borrador para revisión. Contiene ajustes de modelo de datos y endpoints marcados como «PROPUESTA – pendiente de aprobación». |

### 1.1 Historial de versiones

| Versión | Fecha | Autor | Descripción |
|---|---|---|---|
| 1.0 (borrador) | 25-oct-2026 | Pedro Coronado | Versión inicial del FSD vertical inmobiliario, derivado de FSD-001 v1.0. |
| 1.1 (borrador) | 25-oct-2026 | Pedro Coronado | Se adopta «Tranky» como nombre de la aplicación del residente; se aclara su posición como app vertical sobre la plataforma multi-rubro; la sección 14 pasa a «Decisiones a validar durante la implementación». |

### 1.2 Aprobaciones

| Rol | Nombre |
|---|---|
| Cliente / Product Owner | Pedro Coronado |
| Líder técnico | Por definir |
| QA | Por definir |

### 1.3 Convenciones
- **RF-R-xx:** requerimiento funcional de Tranky (portal del residente), alcance principal de este documento.
- **RF-S-xx:** requerimiento de soporte (administradora / backoffice) necesario para que el flujo del residente funcione; se detalla en FSD-001.
- **RNF-xx:** requerimiento no funcional.
- **PROPUESTA:** elemento nuevo o ajuste respecto a FSD-001 que requiere aprobación antes de implementarse.
- **Ejemplo:** valores numéricos ilustrativos; no constituyen reglas de negocio ni tarifas reales.

---

## 2. Objetivo y alcance

### 2.1 Objetivo
La plataforma de recaudación definida en FSD-001 es abierta y multi-rubro. Este documento la especializa para el rubro inmobiliario: edificios y condominios administrados por juntas de propietarios o administradoras en Perú. El foco es el residente pagador (propietario o inquilino), quien a través de Tranky, una aplicación web progresiva (PWA), podrá:
- Pagar sus cuotas de mantenimiento (una o varias en una sola operación) con Yape, tarjeta o código CIP/QR.
- Consultar sus cuotas pendientes, vencidas y pagadas, con desglose y comprobantes en PDF.
- Ver el registro de sus propiedades: departamento(s), depósito(s) y cochera(s), agrupados por edificio y tipo.
- Administrar su billetera de tarjetas tokenizadas y activar el débito automático.
- Recibir avisos y recibos por WhatsApp o correo electrónico, y pagar desde un link de WhatsApp sin instalar ninguna app.

> **Principio rector:** el vocabulario del rubro (edificio, departamento, depósito, cochera, cuota de mantenimiento) vive en la capa de presentación y en las reglas de negocio; el modelo de datos permanece agnóstico (core de FSD-001), de modo que la misma plataforma siga sirviendo a otros rubros sin tocar el núcleo transaccional.

### 2.2 Tranky: propuesta de valor y posicionamiento
Tranky transmite tranquilidad: el residente deja en manos de la solución los temas complicados del edificio (cuotas, vencimientos, moras, comprobantes y el estado de sus propiedades) y los resuelve en pocos toques desde su celular.

Tranky es la app vertical del rubro inmobiliario construida sobre la Plataforma Multi-Rubro de Recaudación y Cobranzas (FSD-001). La marca, el vocabulario del rubro y las reglas propias de edificios viven en la capa de presentación y en la configuración; el core transaccional sigue siendo agnóstico y compartido con otros rubros futuros (colegios, clubes, suscripciones), que podrán tener sus propias apps verticales sin modificar el núcleo.

### 2.3 Dentro del alcance

| Área | Incluye |
|---|---|
| Tranky – portal del residente (principal) | Login, selector de unidades, dashboard, Mis propiedades, cuotas pendientes, cuotas pagadas/historial, checkout multi-cuota, billetera, débito automático, notificaciones, pago desde link de WhatsApp. |
| Soporte administradora (resumen) | Padrón de unidades y residentes, importación .xlsx, emisión mensual de cuotas, cálculo de vencimiento y mora, monitor de conciliación. |
| Soporte backoffice recaudadora (resumen) | Motor de liquidación (settlement), archivo de dispersión bancaria, facturación electrónica de la comisión. |
| Modelo de datos y API | Mapeo rubro → core, ajustes propuestos al modelo y endpoints relevantes al residente. |

### 2.4 Fuera del alcance
- Detalle completo del portal de la administradora y del backoffice (se rige por FSD-001, módulos 2 y 3).
- Otros rubros (colegios, clubes, suscripciones).
- Contabilidad general de la junta de propietarios (presupuestos, gastos, actas, asambleas).
- Gestión de reservas de áreas comunes, control de accesos, visitas o incidencias.
- Aplicaciones nativas iOS/Android (el canal es PWA).
- Planificación detallada de los 4 sprints del MVP (decisión a validar en implementación; ver sección 14).

---

## 3. Glosario del rubro

| Término | Definición |
|---|---|
| Administradora | Empresa o persona que gestiona uno o varios edificios por encargo de sus juntas de propietarios. Es el cliente B2B (tenant). |
| Junta de propietarios | Órgano que agrupa a los propietarios de un edificio en régimen de propiedad exclusiva y común. Es el beneficiario final de lo recaudado. |
| Edificio / condominio | Inmueble que agrupa unidades inmobiliarias; unidad organizativa de la administradora. |
| Unidad inmobiliaria | Bien de propiedad exclusiva dentro del edificio: departamento, depósito o cochera. |
| Departamento | Unidad de vivienda. Atributos típicos: piso, número, área (m²), alícuota. |
| Depósito | Unidad de almacenamiento. Atributos típicos: número, nivel/sótano, área (m²), alícuota. |
| Cochera / estacionamiento | Espacio para vehículo. Atributos típicos: número, nivel/sótano, techada o no, área (m²), alícuota. |
| Alícuota / porcentaje de participación | Porcentaje que corresponde a cada unidad sobre los bienes y gastos comunes; base usual del cálculo de la cuota. |
| Cuota de mantenimiento ordinaria | Cobro periódico (normalmente mensual) para cubrir los gastos comunes del edificio. |
| Cuota extraordinaria | Cobro puntual aprobado por la junta para un gasto no recurrente (p. ej. cambio de ascensor, pintado de fachada). |
| Aviso de cobranza | Documento (PDF) que detalla la cuota emitida para una unidad y periodo, con su desglose. |
| Comprobante de recaudación / recibo | Constancia (PDF) emitida tras confirmarse el pago por webhook. |
| Mora | Recargo aplicado a una cuota vencida según la regla del edificio (interés diario o penalidad fija). |
| Propietario | Titular de la unidad inmobiliaria. |
| Inquilino / residente | Ocupante de la unidad por arrendamiento; puede estar habilitado a pagar ciertas cuotas. |
| Recaudadora | Empresa operadora de la plataforma que recauda por cuenta de terceros y liquida a la junta. |
| Liquidación (Pay-out) | Transferencia a la cuenta bancaria del edificio del neto recaudado, descontadas comisiones e IGV de la comisión. |
| CIP | Código de pago para pagar en agentes, banca por internet o QR; vigencia de 24 h. |
| 3DS | 3-D Secure: autenticación adicional del titular de la tarjeta exigida por el emisor. |
| OTP | Código de un solo uso (One-Time Password), usado en login por WhatsApp/SMS y en pagos con Yape (6 dígitos). |

---

## 4. Actores y roles

| Actor | Entidad core | Descripción | Interacción con Tranky |
|---|---|---|---|
| Propietario | `payers` + `unit_payer_relations` (rol PROPIETARIO) | Titular de una o varias unidades. | Consulta y paga cuotas; ve sus propiedades e historial. |
| Inquilino | `payers` + `unit_payer_relations` (rol INQUILINO) | Ocupante de una unidad arrendada. | Consulta y paga las cuotas que le correspondan según la regla del edificio (decisión a validar P-01). |
| Administradora | `tenants` (rubro INMOBILIARIO) | Cliente B2B que gestiona edificios. | Mantiene padrón, emite cuotas, monitorea cobranza (portal B2B, FSD-001 módulo 2). |
| Junta de propietarios | `organization_units` (cuenta bancaria del edificio) | Beneficiaria de los fondos recaudados de su edificio. | Recibe liquidaciones; no opera Tranky. |
| Recaudadora | Operador de la plataforma | Recauda por cuenta de terceros, liquida y factura su comisión. | Backoffice (FSD-001 módulo 3). |
| Pasarela de pago | Adaptador Strategy (Culqi, Niubiz, Izipay, Yape) | Procesa cargos y notifica por webhook. | Sistema externo. |

### 4.1 Relación propietario / inquilino en una misma unidad
Una misma unidad (`billing_unit`) puede tener simultáneamente un propietario y un inquilino activos mediante registros en `unit_payer_relations` (`billing_unit_id`, `payer_id`, `rol ∈ {PROPIETARIO, INQUILINO}`, `activo`). Esta coexistencia es la que permite separar responsabilidades de pago, por ejemplo:
- Cuotas ordinarias visibles y pagables por el inquilino activo.
- Cuotas extraordinarias visibles y pagables solo por el propietario.
- Al terminar el arrendamiento, la administradora marca la relación del inquilino como `activo = false`; el historial se conserva (no se borra).

> **Decisión a validar en implementación (P-01, P-02):** la regla exacta de qué cuotas paga y ve cada rol no está definida en FSD-001. Se propone parametrizarla por edificio (`organization_unit`) en configuración, no en código. Para soportarla, cada cuota debe poder clasificarse como ORDINARIA o EXTRAORDINARIA (p. ej. en `concepto_principal` o en `detalle_items_json`; ver ajuste (e) en la sección 10.2).

### 4.2 Matriz de permisos (propuesta)

| Acción | Propietario | Inquilino | Administradora |
|---|---|---|---|
| Ver sus unidades vinculadas | Sí | Sí (solo unidades donde tiene relación activa) | Sí (todas las del tenant) |
| Ver cuotas ordinarias | Sí | Sí | Sí |
| Ver / pagar cuotas extraordinarias | Sí | A definir (P-01) | Ver: sí |
| Pagar cuotas | Sí | Sí, según regla del edificio | No (registra pagos manuales fuera de alcance) |
| Ver historial de pagos de la unidad | Sí | A definir: solo los propios o todos los de la unidad | Sí |
| Registrar / editar unidades | No (lo hace la administradora) | No (P-02) | Sí |
| Gestionar billetera y débito automático | Sí (propia) | Sí (propia) | No |

---

## 5. Mapa de la propiedad del residente
Un pagador puede estar vinculado a varias unidades: por ejemplo, un departamento con su depósito y su cochera en el mismo edificio, o varias unidades en distintos edificios (incluso de distintas administradoras). Tranky debe mostrarlas de forma comprensible para el residente, sin alterar el modelo core.

### 5.1 Mapeo término del rubro → entidad core

| Término del rubro (presentación) | Entidad core (FSD-001) | Cómo se representa |
|---|---|---|
| Administradora | `tenants` | `rubro = INMOBILIARIO`; `config_comision_json` define quién asume la comisión. |
| Edificio / condominio | `organization_units` | `nombre`, `direccion`, `moneda_base`, `bank_account_id`; reglas de mora del edificio en configuración. |
| Departamento | `billing_units` | `tipo_unidad = DEPARTAMENTO` (o `metadata_json.tipo`); `codigo_interno` p. ej. DPTO-402; `metadata_json`: piso, area_m2, alicuota. |
| Depósito | `billing_units` | `tipo_unidad = DEPOSITO`; `codigo_interno` p. ej. DEP-S1-12; `metadata_json`: nivel, area_m2, alicuota. |
| Cochera | `billing_units` | `tipo_unidad = COCHERA`; `codigo_interno` p. ej. COCH-S2-07; `metadata_json`: numero, nivel, techada, area_m2, alicuota. |
| Propietario / Inquilino | `payers` + `unit_payer_relations` | Persona en `payers`; rol PROPIETARIO / INQUILINO y `activo` en la relación. |
| Cuota de mantenimiento / extraordinaria | `debts` | `periodo` YYYY-MM, `concepto_principal`, montos, `detalle_items_json`, `estado`. |
| Aviso de cobranza (PDF) | `debts` (documento generado) | Generado a partir de `debts.detalle_items_json`. |
| Pago del residente | `transactions` (+ `transaction_debts`, PROPUESTA) | Una operación puede cubrir varias cuotas. |
| Recibo / comprobante de recaudación | `transactions` (documento generado) | PDF emitido tras webhook `charge.succeeded`. |
| Tarjeta guardada | `payment_methods_vault` | Solo `token_id`, marca y últimos 4 dígitos. |
| Liquidación a la junta | `settlements` | Por `tenant_id` y `organization_unit_id`. |

> **Regla:** no se crean tablas por rubro (ni «edificios», ni «departamentos», ni «cocheras»). El tipo de unidad es un valor genérico y sus atributos variables viven en `metadata_json` (JSONB).

### 5.2 Ejemplo de metadata_json por tipo de unidad (ejemplo ilustrativo)

| Tipo | codigo_interno (ejemplo) | metadata_json (ejemplo) |
|---|---|---|
| DEPARTAMENTO | DPTO-402 | `{"tipo":"DEPARTAMENTO","piso":4,"numero":"402","area_m2":85.5,"alicuota":1.25,"dormitorios":3}` |
| DEPOSITO | DEP-S1-12 | `{"tipo":"DEPOSITO","nivel":"S1","numero":"12","area_m2":4.0,"alicuota":0.10}` |
| COCHERA | COCH-S2-07 | `{"tipo":"COCHERA","nivel":"S2","numero":"07","techada":true,"area_m2":12.5,"alicuota":0.30}` |

Los valores son de ejemplo. El esquema JSON por tipo se valida en la capa de aplicación (p. ej. con un JSON Schema por rubro y tipo), no con columnas específicas en la tabla.

### 5.3 Registro de propiedades («Mis propiedades»)
- **Agrupación:** primero por edificio (`organization_unit`), luego por tipo (Departamentos, Depósitos, Cocheras).
- **Datos por unidad:** código interno, alias, tipo, atributos de `metadata_json` relevantes (piso, área, alícuota, nro. de cochera, techada, etc.), rol del pagador (Propietario / Inquilino) y estado de la relación.
- **Cuotas asociadas:** por unidad (saldo pendiente, vencido, última cuota pagada) y consolidado por edificio y total general.
- **Vinculación lógica departamento–depósito–cochera:** opcional, mediante `metadata_json` (p. ej. `"unidad_principal_id"`) solo con fines de presentación; cada unidad sigue siendo un `billing_unit` independiente con sus propias cuotas (ver P-04).

---

## 6. Requerimientos funcionales de Tranky (portal del residente)
Cada requerimiento indica su trazabilidad con FSD-001, reglas de negocio y criterios de aceptación en formato Dado / Cuando / Entonces.

### 6.1 Resumen

| ID | Requerimiento | Base FSD-001 | Prioridad |
|---|---|---|---|
| RF-R-01 | Inicio de sesión (documento + contraseña u OTP WhatsApp/SMS) | RF-1.1 | Alta |
| RF-R-02 | Selector de unidades | RF-1.1 | Alta |
| RF-R-03 | Dashboard de deuda | RF-1.2 | Alta |
| RF-R-04 | Mis propiedades | Nuevo (vertical) | Alta |
| RF-R-05 | Cuotas pendientes y vencidas | RF-1.2 | Alta |
| RF-R-06 | Cuotas pagadas / historial y comprobantes | RF-1.2 | Alta |
| RF-R-07 | Checkout multi-cuota | RF-1.4 | Alta |
| RF-R-08 | Pago con Yape (API + OTP) | RF-1.4 | Alta |
| RF-R-09 | Pago con tarjeta (guardada 1 clic / nueva con 3DS) | RF-1.3, RF-1.4 | Alta |
| RF-R-10 | Pago con código CIP / QR | RF-1.4 | Alta |
| RF-R-11 | Billetera de tarjetas | RF-1.3 | Alta |
| RF-R-12 | Débito automático | RF-1.3 | Media |
| RF-R-13 | Notificaciones y recibo | Flujo de pago | Alta |
| RF-R-14 | Pago desde link de WhatsApp | Stack / PWA | Alta |

### 6.2 Detalle de requerimientos

#### RF-R-01 – Inicio de sesión
- **Prioridad:** Alta (MVP) · **Trazabilidad:** FSD-001 RF-1.1 · **Endpoint(s):** `POST /api/v1/auth/login`
- **Descripción:** el residente ingresa con su tipo y número de documento (DNI, CE o RUC) y contraseña, o solicita un OTP enviado por WhatsApp o SMS a su teléfono registrado.

**Reglas de negocio**
- El documento debe existir en `payers`; si no existe, se muestra un mensaje genérico (no revelar si el documento está registrado).
- La contraseña se almacena solo como hash (`password_hash`); nunca en texto plano.
- El OTP es de un solo uso, con expiración y número máximo de intentos (valores a definir).
- Tras N intentos fallidos se bloquea temporalmente el acceso (N a definir).
- La sesión emite un token con `payer_id` y caducidad; el residente solo accede a unidades donde tiene relación activa.

**Criterios de aceptación**
1. Dado un residente registrado con documento y contraseña válidos, cuando ingresa sus credenciales, entonces accede a Tranky y ve el selector de unidades o su dashboard.
2. Dado un residente con teléfono WhatsApp registrado, cuando solicita OTP e ingresa el código correcto dentro de su vigencia, entonces inicia sesión sin contraseña.
3. Dado un OTP vencido o ya usado, cuando el residente lo ingresa, entonces el sistema rechaza el acceso y ofrece reenviar un nuevo código.

#### RF-R-02 – Selector de unidades
- **Prioridad:** Alta (MVP) · **Trazabilidad:** FSD-001 RF-1.1 · **Endpoint(s):** `GET /api/v1/payer/units`
- **Descripción:** si el residente tiene más de una unidad vinculada, puede elegir una unidad específica o la vista consolidada «Todas mis unidades».

**Reglas de negocio**
- Solo se listan unidades con `unit_payer_relations.activo = true` para el payer autenticado.
- Las unidades se agrupan por edificio y tipo (Departamento, Depósito, Cochera), mostrando el rol del residente.
- Si tiene una sola unidad, el selector se omite y se abre el dashboard directamente.
- La unidad seleccionada se conserva durante la sesión.

**Criterios de aceptación**
1. Dado un propietario con departamento, depósito y cochera en un edificio, cuando inicia sesión, entonces ve las tres unidades agrupadas bajo el edificio con su tipo y código.
2. Dado un inquilino cuya relación fue desactivada, cuando inicia sesión, entonces esa unidad no aparece en el selector.

#### RF-R-03 – Dashboard de deuda
- **Prioridad:** Alta (MVP) · **Trazabilidad:** FSD-001 RF-1.2 · **Endpoint(s):** `GET /api/v1/payer/units/{id}/debts`; `GET /api/v1/payer/properties` (PROPUESTA)
- **Descripción:** pantalla principal con la deuda total del residente y accesos rápidos a pagar, ver pendientes, historial y propiedades.

**Reglas de negocio**
- Deuda total = Σ `debts.monto_total` de cuotas en estado PENDIENTE y VENCIDO de las unidades visibles para el rol del residente.
- Se muestra por separado el monto vencido (incluida mora) y el próximo vencimiento.
- Se puede filtrar por unidad o ver consolidado; montos agrupados por moneda (PEN / USD) sin convertir entre monedas.
- Las cuotas EN_PROCESO (propuesta) se muestran como «pago en proceso» y no se suman como deuda pagable.

**Criterios de aceptación**
1. Dado un residente con dos cuotas PENDIENTE y una VENCIDO, cuando abre el dashboard, entonces ve la suma de las tres y el monto vencido destacado.
2. Dado un residente sin deudas, cuando abre el dashboard, entonces ve el mensaje «Estás al día» y el acceso a su historial.

#### RF-R-04 – Mis propiedades
- **Prioridad:** Alta (MVP) · **Trazabilidad:** Nuevo (vertical) · **Endpoint(s):** `GET /api/v1/payer/units`; `GET /api/v1/payer/properties` (PROPUESTA)
- **Descripción:** registro de las propiedades del residente: departamentos, depósitos y cocheras, agrupados por edificio y tipo, con sus datos y estado de cuenta.

**Reglas de negocio**
- Datos mostrados por unidad: edificio, dirección, tipo, código interno, alias, atributos de `metadata_json` (piso, área m², alícuota, nro. de cochera, techada, etc.), rol del residente.
- Estado de cuenta por unidad: saldo pendiente, saldo vencido, fecha y monto del último pago.
- Totales consolidados por edificio y general.
- Consulta de solo lectura: el residente no crea ni edita unidades (la administradora mantiene el padrón; ver P-02).
- El inquilino ve solo las unidades donde tiene relación activa.

**Criterios de aceptación**
1. Dado un propietario con unidades en dos edificios, cuando abre «Mis propiedades», entonces ve dos grupos de edificio, cada uno con sus unidades por tipo y su subtotal.
2. Dado una cochera con `metadata_json.techada = true`, cuando el residente ve su detalle, entonces se muestra «Cochera techada» con su número y nivel.
3. Dado un dato incorrecto en su unidad, cuando el residente lo detecta, entonces dispone de una opción «Reportar dato incorrecto» que notifica a la administradora (sin editar el dato).

#### RF-R-05 – Cuotas pendientes y vencidas
- **Prioridad:** Alta (MVP) · **Trazabilidad:** FSD-001 RF-1.2 · **Endpoint(s):** `GET /api/v1/payer/units/{id}/debts`; `GET /api/v1/payer/debts/{id}/notice.pdf` (PROPUESTA)
- **Descripción:** listado de cuotas PENDIENTE y VENCIDO, ordenadas por fecha de vencimiento ascendente, con desglose y aviso en PDF.

**Reglas de negocio**
- Orden: `fecha_vencimiento` ascendente (las vencidas primero).
- Cada cuota muestra: unidad, periodo, concepto, tipo (ordinaria / extraordinaria), fecha de vencimiento, `monto_base`, `monto_mora`, `monto_total` y estado.
- El desglose proviene de `detalle_items_json` (p. ej. limpieza, vigilancia, agua común, fondo de reserva; ejemplo).
- Las cuotas VENCIDO muestran la mora calculada por el cron diario según la regla del edificio.
- Descarga del aviso de cobranza en PDF por cuota.
- Se pueden seleccionar varias cuotas (checkbox) para pagarlas juntas; la política de orden obligatorio de pago (p. ej. pagar primero la más antigua) está a definir.

**Criterios de aceptación**
1. Dado tres cuotas de distintos periodos, cuando el residente abre «Pendientes», entonces se listan de la más antigua a la más reciente.
2. Dado una cuota con `detalle_items_json` de cuatro conceptos, cuando el residente expande la cuota, entonces ve los cuatro conceptos con sus montos y la suma coincide con `monto_base`.
3. Dado una cuota vencida, cuando el residente la consulta, entonces ve `monto_base`, `monto_mora` y `monto_total` por separado.

#### RF-R-06 – Cuotas pagadas / historial
- **Prioridad:** Alta (MVP) · **Trazabilidad:** FSD-001 RF-1.2 · **Endpoint(s):** `GET /api/v1/payer/units/{id}/transactions`; `GET /api/v1/payer/transactions/{id}/receipt.pdf` (PROPUESTA)
- **Descripción:** historial de pagos con total histórico pagado y descarga del comprobante de recaudación en PDF.

**Reglas de negocio**
- Se listan transacciones confirmadas (estado exitoso por webhook) de las unidades visibles para el residente, de la más reciente a la más antigua.
- Cada registro muestra: fecha, código de operación, método de pago, cuotas cubiertas (vía `transaction_debts`, PROPUESTA) y monto.
- Total histórico pagado = Σ montos aplicados a las cuotas de la unidad o del consolidado.
- Los extornos se muestran como movimiento inverso vinculado a la transacción original (nunca se ocultan ni se borran).
- Filtros por unidad, periodo y año.

**Criterios de aceptación**
1. Dado un residente con 12 pagos, cuando abre «Pagadas», entonces ve los 12 pagos y el total histórico.
2. Dado un pago confirmado, cuando el residente pulsa «Descargar comprobante», entonces obtiene el PDF con código de operación, cuotas cubiertas y monto.
3. Dado un pago extornado, cuando el residente revisa su historial, entonces ve el pago original y el asiento de extorno, y la cuota vuelve a figurar como pendiente o vencida.

#### RF-R-07 – Checkout multi-cuota
- **Prioridad:** Alta (MVP) · **Trazabilidad:** FSD-001 RF-1.4 · **Endpoint(s):** `POST /api/v1/payments/checkout`
- **Descripción:** pago de una o varias cuotas (de una o varias unidades del mismo edificio) en una sola operación.

**Reglas de negocio**
- El backend recalcula el monto a cobrar desde la base de datos; nunca confía en montos enviados por el navegador.
- Cada cuota seleccionada se bloquea con `SELECT ... FOR UPDATE` y pasa a EN_PROCESO (propuesta) mientras dura el intento.
- Se genera un `Idempotency-Key` único por intento de pago.
- Se muestra el resumen: cuotas, subtotal, comisión (si la asume el pagador según `config_comision_json`) y total.
- Restricción propuesta: una operación solo agrupa cuotas de la misma `organization_unit` y moneda, para simplificar la liquidación por edificio (a validar).
- Pagos parciales de una cuota: a definir (P-05).
- La confirmación final la da el webhook, no la respuesta del navegador.

**Criterios de aceptación**
1. Dado dos cuotas seleccionadas, cuando el residente confirma el pago, entonces se crea una transacción con dos registros en `transaction_debts` y ambas cuotas pasan a EN_PROCESO.
2. Dado que dos pagadores de la misma unidad intentan pagar la misma cuota a la vez, cuando ambos confirman, entonces solo uno obtiene el bloqueo; el otro recibe «Esta cuota tiene un pago en proceso».
3. Dado que el navegador se cierra tras enviar el pago, cuando llega el webhook `charge.succeeded`, entonces las cuotas quedan PAGADO y se envía el recibo.

#### RF-R-08 – Pago con Yape
- **Prioridad:** Alta (MVP) · **Trazabilidad:** FSD-001 RF-1.4 · **Endpoint(s):** `POST /api/v1/payments/checkout`
- **Descripción:** pago directo vía API de Yape ingresando el número de celular y el OTP de 6 dígitos generado en la app Yape.

**Reglas de negocio**
- Validación de formato: celular peruano y OTP numérico de 6 dígitos.
- El OTP no se almacena; se envía a la pasarela y se descarta.
- Si el OTP es rechazado, las cuotas se liberan (EN_PROCESO → estado anterior) y se permite reintentar con un nuevo `Idempotency-Key`.

**Criterios de aceptación**
1. Dado un celular y OTP válidos, cuando el residente confirma, entonces se ejecuta el cargo y, al llegar el webhook, las cuotas pasan a PAGADO.
2. Dado un OTP con 5 dígitos, cuando el residente intenta confirmar, entonces el formulario no permite enviar y muestra el error de formato.

#### RF-R-09 – Pago con tarjeta
- **Prioridad:** Alta (MVP) · **Trazabilidad:** FSD-001 RF-1.3, RF-1.4 · **Endpoint(s):** `POST /api/v1/payments/checkout`; `POST /api/v1/payer/payment-methods`
- **Descripción:** pago con tarjeta guardada en un clic, o con tarjeta nueva tokenizada en el frontend con autenticación 3DS cuando el emisor la requiera.

**Reglas de negocio**
- La tarjeta nueva se tokeniza con el SDK de la pasarela en el navegador; PAN y CVV nunca llegan a nuestros servidores.
- El backend solo recibe `token_id`; opcionalmente el residente marca «Guardar tarjeta».
- El desafío 3DS se resuelve en el frontend; el resultado final se confirma por webhook.

**Criterios de aceptación**
1. Dado una tarjeta guardada, cuando el residente pulsa «Pagar» con ella, entonces se ejecuta el cargo sin volver a ingresar datos.
2. Dado una tarjeta nueva que exige 3DS, cuando el residente completa el desafío, entonces el pago se procesa y se confirma por webhook.
3. Dado una inspección del tráfico al backend, cuando se paga con tarjeta nueva, entonces solo viaja el token, nunca el número de tarjeta ni el CVV.

#### RF-R-10 – Pago con código CIP / QR
- **Prioridad:** Alta (MVP) · **Trazabilidad:** FSD-001 RF-1.4 · **Endpoint(s):** `POST /api/v1/payments/checkout`
- **Descripción:** generación de un código CIP o QR para pagar en banca por internet, agentes o billeteras, con vigencia de 24 horas.

**Reglas de negocio**
- El CIP tiene vigencia de 24 h; al expirar, las cuotas se liberan y el CIP queda anulado.
- Mientras el CIP esté vigente, las cuotas se muestran como «pago en proceso» (EN_PROCESO) para evitar doble pago; la política exacta de reserva está a definir.
- El pago se confirma únicamente por webhook de la pasarela.

**Criterios de aceptación**
1. Dado un CIP generado, cuando el residente paga en su banca dentro de 24 h, entonces llega el webhook y las cuotas pasan a PAGADO.
2. Dado un CIP no pagado, cuando transcurren 24 h, entonces el CIP expira y las cuotas vuelven a PENDIENTE o VENCIDO.

#### RF-R-11 – Billetera de tarjetas
- **Prioridad:** Alta (MVP) · **Trazabilidad:** FSD-001 RF-1.3 · **Endpoint(s):** `POST /api/v1/payer/payment-methods`; `DELETE /api/v1/payer/payment-methods/{id}`
- **Descripción:** gestión de tarjetas guardadas: listar, agregar (tokenizada), marcar predeterminada y eliminar.

**Reglas de negocio**
- Se almacena solo: pasarela, `token_id`, marca y últimos 4 dígitos (`payment_methods_vault`).
- Desvincular una tarjeta la desactiva para uso futuro; no altera transacciones pasadas.
- Si la tarjeta tiene débito automático activo, se pide confirmación antes de desvincularla.

**Criterios de aceptación**
1. Dado un residente con dos tarjetas, cuando abre su billetera, entonces ve marca y últimos 4 dígitos de cada una.
2. Dado una tarjeta con débito automático, cuando el residente la elimina y confirma, entonces se desvincula y el débito automático queda desactivado.

#### RF-R-12 – Débito automático
- **Prioridad:** Media (MVP) · **Trazabilidad:** FSD-001 RF-1.3 · **Endpoint(s):** `POST /api/v1/payer/payment-methods`
- **Descripción:** activación de cargo recurrente de las cuotas emitidas sobre una tarjeta guardada.

**Reglas de negocio**
- Se activa con el switch `debito_automatico_activo` de `payment_methods_vault`.
- Los cargos recurrentes se ejecutan por cola (Redis + BullMQ), cada uno con su `Idempotency-Key`.
- Alcance del débito (qué unidades, ordinarias y/o extraordinarias, día de cargo, reintentos ante rechazo) a definir.
- Se notifica al residente el resultado de cada cargo automático.

**Criterios de aceptación**
1. Dado el débito automático activo, cuando se emite una nueva cuota, entonces se programa el cargo y, al confirmarse por webhook, la cuota queda PAGADO y se envía el recibo.
2. Dado un cargo automático rechazado, cuando la pasarela notifica el rechazo, entonces la cuota sigue PENDIENTE y el residente recibe aviso para pagar manualmente.

#### RF-R-13 – Notificaciones y recibo
- **Prioridad:** Alta (MVP) · **Trazabilidad:** FSD-001 Flujo de pago · **Endpoint(s):** `POST /api/v1/webhooks/gateway/{provider}`
- **Descripción:** envío de avisos de cobranza, recordatorios de vencimiento y recibos de pago por WhatsApp y/o correo electrónico.

**Reglas de negocio**
- El recibo se envía solo después del webhook `charge.succeeded` validado con HMAC.
- Los envíos masivos y la generación de PDFs se procesan en cola (BullMQ) con reintentos.
- Canal por defecto y preferencias del residente (WhatsApp, email o ambos) a definir.
- Plantillas de WhatsApp sujetas a aprobación del proveedor de mensajería.

**Criterios de aceptación**
1. Dado un pago confirmado por webhook, cuando el sistema procesa la confirmación, entonces el residente recibe el recibo PDF por WhatsApp y/o email.
2. Dado un pago en estado EN_PROCESO sin webhook, cuando el navegador muestra «éxito» de la pasarela, entonces no se envía recibo hasta recibir el webhook.

#### RF-R-14 – Pago desde link de WhatsApp
- **Prioridad:** Alta (MVP) · **Trazabilidad:** FSD-001 Stack / PWA · **Endpoint(s):** `GET /api/v1/payer/pay-links/{token}` (PROPUESTA); `POST /api/v1/payments/checkout`
- **Descripción:** el residente recibe por WhatsApp un link al aviso de cobranza y puede pagar desde el navegador del celular en alrededor de 15 segundos, sin instalar ninguna app.

**Reglas de negocio**
- El link lleva un token firmado, de un solo uso y con expiración, asociado a la cuota y al pagador (sin exponer IDs secuenciales).
- El link abre directamente el checkout de la cuota; para ver otras unidades o el historial se requiere login completo.
- Tranky (PWA) debe ser ligera y responsive (mobile-first).

**Criterios de aceptación**
1. Dado un link válido de WhatsApp, cuando el residente lo abre y paga con Yape, entonces completa el pago sin instalar apps ni registrarse.
2. Dado un link expirado, cuando el residente lo abre, entonces se le pide iniciar sesión o solicitar un nuevo link.

---

## 7. Requerimientos de soporte (administradora y backoffice)
Se resumen solo los requerimientos necesarios para que el flujo del residente funcione. Su especificación completa está en FSD-001 (módulos 2 y 3).

| ID | Requerimiento | Base FSD-001 | Resumen y reglas relevantes para el residente |
|---|---|---|---|
| RF-S-01 | Padrón de unidades y residentes | RF-2.1 | CRUD de `billing_units` (con tipo DEPARTAMENTO/DEPOSITO/COCHERA y `metadata_json`) y `payers`; vínculo con rol PROPIETARIO/INQUILINO. |
| RF-S-02 | Importación masiva .xlsx | RF-2.1 | Validación previa de DNIs duplicados, formatos inválidos, tipos de unidad no reconocidos y códigos internos repetidos en el edificio; reporte de errores por fila antes de confirmar. |
| RF-S-03 | Emisión mensual masiva de cuotas | RF-2.2 | Genera `debts` por `billing_unit` y periodo (YYYY-MM), con `detalle_items_json`; no duplica cuotas del mismo periodo y concepto (idempotente). Dispara avisos por WhatsApp/email. |
| RF-S-04 | Cron diario 00:01 de vencimiento y mora | RF-2.2 | Si `fecha_actual > fecha_vencimiento` y `estado = PENDIENTE` → VENCIDO; recalcula `monto_mora` según la regla del edificio (interés diario o penalidad fija). Parámetros (tasa, días de gracia) a definir (P-03). |
| RF-S-05 | Monitor de conciliación | RF-2.3 | KPIs por edificio: total emitido, recaudado, % efectividad, mora; saldo en tránsito (T+1/T+2), saldo disponible y reporte de transferencias. |
| RF-S-06 | Liquidación (settlement engine) | RF-3.1 | Agrupa transacciones exitosas con `settlement_id IS NULL` por tenant y edificio; descuenta comisiones; genera .TXT de dispersión (Telecrédito BCP, BBVA Netcash, Interbank). |
| RF-S-07 | Facturación electrónica | RF-3.2 | Al cerrar la liquidación, emite comprobante electrónico (OSE/PSE, p. ej. Nubefact/TeFacturo) por la comisión; IGV solo sobre la comisión de recaudación. |

### 7.1 Fórmula de liquidación

```text
Monto neto a transferir = Σ monto cobrado − (comisión pasarela + comisión recaudadora + IGV de la comisión)
```

Ejemplo ilustrativo (valores ficticios, no son tarifas reales): Σ cobrado = S/ 10 000,00; comisión pasarela = S/ X; comisión recaudadora = S/ Y; IGV calculado únicamente sobre la comisión de recaudación según la tasa vigente. Neto = 10 000,00 − (X + Y + IGV(comisión)). Las tarifas reales y la base exacta del IGV (si incluye o no la comisión de pasarela) se validarán durante la implementación con el área contable (P-07).

---

## 8. Flujos principales

### 8.1 Flujo: pagar cuotas de mantenimiento
1. El residente inicia sesión (o abre el link de WhatsApp) y elige la unidad o la vista consolidada.
2. Abre «Cuotas pendientes», selecciona una o varias cuotas y pulsa «Pagar».
3. Tranky muestra el resumen (cuotas, comisión si aplica, total) y el residente elige el método: Yape, tarjeta guardada, tarjeta nueva o CIP/QR.
4. Si es tarjeta nueva, el SDK de la pasarela tokeniza la tarjeta en el navegador; si es Yape, el residente ingresa celular y OTP de 6 dígitos.
5. La PWA invoca `POST /api/v1/payments/checkout` con los IDs de cuota y el token u OTP.
6. El backend, en una transacción de base de datos, bloquea las cuotas (`SELECT ... FOR UPDATE`), valida estado y montos, las marca EN_PROCESO (propuesta) y registra la transacción en estado pendiente con sus filas en `transaction_debts`.
7. El backend ejecuta el cargo en la pasarela (adaptador Strategy) con un `Idempotency-Key` único por intento.
8. Tranky muestra «Pago en proceso»; el resultado del navegador no confirma el pago.
9. La pasarela envía el webhook `charge.succeeded` a `POST /api/v1/webhooks/gateway/{provider}`, firmado con HMAC.
10. El backend valida la firma HMAC, procesa el evento de forma idempotente (ignora duplicados), marca la transacción exitosa y las cuotas como PAGADO.
11. Se encola la generación del recibo PDF y su envío por WhatsApp/email; Tranky refleja el estado PAGADO.
12. Si llega `charge.failed` o expira el intento, las cuotas se liberan a su estado previo (PENDIENTE o VENCIDO).

### 8.2 Flujo: ver propiedades e historial
1. El residente inicia sesión.
2. Abre «Mis propiedades»: el sistema consulta `GET /api/v1/payer/units` (y el consolidado propuesto) filtrando por payer y relaciones activas.
3. Se muestran edificios → tipos → unidades con sus datos y saldos.
4. El residente elige una unidad y abre «Cuotas pagadas».
5. El sistema consulta `GET /api/v1/payer/units/{id}/transactions` y muestra los pagos y el total histórico.
6. El residente descarga el comprobante de recaudación en PDF de un pago.

### 8.3 Flujo: alta de tarjeta y débito automático
1. El residente abre «Billetera» y pulsa «Agregar tarjeta».
2. El SDK de la pasarela captura los datos en un formulario seguro y devuelve `token_id` (PAN y CVV no pasan por el backend).
3. La PWA envía `POST /api/v1/payer/payment-methods` con `token_id` y el flag de débito automático.
4. El backend registra en `payment_methods_vault`: pasarela, `token_id`, marca, últimos 4 dígitos.
5. Si activa débito automático, el residente confirma el alcance (unidades y tipos de cuota, a definir).
6. En cada emisión, la cola programa el cargo con `Idempotency-Key`; el resultado se confirma por webhook y se notifica al residente.
7. El residente puede desactivar el débito o eliminar la tarjeta (`DELETE /api/v1/payer/payment-methods/{id}`).

---

## 9. Estados de la cuota

| Estado | Origen | Descripción |
|---|---|---|
| PENDIENTE | FSD-001 | Cuota emitida, dentro de plazo, sin pago confirmado. |
| VENCIDO | FSD-001 | `fecha_actual > fecha_vencimiento` sin pago; aplica mora según regla del edificio. |
| PAGADO | FSD-001 | Pago confirmado por webhook validado con HMAC. |
| EN_PROCESO | PROPUESTA | Cuota reservada por un intento de pago en curso (cargo enviado, CIP vigente o 3DS pendiente). Evita doble cobro y se muestra al residente como «pago en proceso». |
| EXTORNADO | PROPUESTA | No es un estado que borre el pago: se registra un asiento inverso en `transactions` vinculado al original. Puede modelarse como estado de la transacción y no de la cuota; la cuota vuelve a PENDIENTE o VENCIDO según su fecha de vencimiento. |

### 9.1 Tabla de transiciones

| Desde | Hacia | Evento / disparador | Responsable |
|---|---|---|---|
| (nueva) | PENDIENTE | Emisión mensual o cuota extraordinaria | Administradora (RF-S-03) |
| PENDIENTE | VENCIDO | Cron 00:01: `fecha_actual > fecha_vencimiento`; recalcula mora | Sistema (RF-S-04) |
| PENDIENTE / VENCIDO | EN_PROCESO | `POST /checkout` con bloqueo FOR UPDATE (propuesta) | Residente / sistema |
| EN_PROCESO | PAGADO | Webhook `charge.succeeded` con HMAC válido | Pasarela / sistema |
| EN_PROCESO | PENDIENTE / VENCIDO | Webhook `charge.failed`, expiración del CIP (24 h) o timeout del intento | Pasarela / sistema |
| PENDIENTE | PAGADO | Webhook directo (si no se usa EN_PROCESO) | Pasarela / sistema |
| VENCIDO | VENCIDO | Cron diario recalcula `monto_mora` | Sistema |
| PAGADO | PENDIENTE / VENCIDO | Extorno registrado como asiento inverso (propuesta EXTORNADO) | Backoffice |

> **Regla:** mientras una cuota está EN_PROCESO, el cron de mora debe definir si sigue sumando mora o la congela (a definir). Ninguna transición elimina registros de `transactions` o `settlements`.

---

## 10. Modelo de datos

### 10.1 Tablas core (FSD-001)

| Tabla | Equivalencia en el rubro | Campos clave |
|---|---|---|
| `tenants` | Administradora | id, ruc, razon_social, rubro, estado, config_comision_json (fijo, %, asume: PAGADOR \| TENANT) |
| `organization_units` | Edificio / condominio | id, tenant_id, nombre, direccion, moneda_base (PEN, USD), bank_account_id |
| `billing_units` | Departamento / depósito / cochera | id, organization_unit_id, codigo_interno, alias, metadata_json |
| `payers` | Propietario / inquilino | id, tipo_doc, num_doc, nombres, apellidos, email, telefono_whatsapp, password_hash |
| `unit_payer_relations` | Vínculo unidad–residente | id, billing_unit_id, payer_id, rol (PROPIETARIO, INQUILINO), activo |
| `debts` | Cuota de mantenimiento | id, billing_unit_id, periodo, concepto_principal, fecha_vencimiento, monto_base, monto_mora, monto_total, detalle_items_json, estado |
| `payment_methods_vault` | Tarjetas guardadas | id, payer_id, pasarela, token_id, marca, ultimos_4_digitos, debito_automatico_activo |
| `transactions` | Pago del residente (Pay-in) | id, codigo_operacion, payer_id, metodo_pago, monto_total_cobrado, comision_pasarela, comision_recaudadora, monto_neto_a_liquidar, estado |
| `settlements` | Liquidación a la junta (Pay-out) | id, tenant_id, organization_unit_id, fecha_corte, monto_bruto_recaudado, total_comisiones_retenidas, monto_neto_transferido, nro_operacion_bancaria, estado |

### 10.2 Ajustes propuestos (PROPUESTA – pendiente de aprobación)
Durante la derivación se detectaron huecos en el modelo de FSD-001. Se proponen los siguientes ajustes, todos agnósticos al rubro:

| # | Ajuste | Motivo / hueco detectado | Detalle propuesto |
|---|---|---|---|
| (a) | `transactions.settlement_id` | RF-3.1 filtra por `settlement_id IS NULL`, pero la columna no existe en `transactions`. | FK nullable a `settlements(id)`. Se asigna una sola vez al liquidar; no se sobrescribe. |
| (b) | `transactions.tenant_id` y `transactions.organization_unit_id` | Aislamiento multi-tenant y liquidación por edificio sin joins frágiles vía debts. | FKs NOT NULL; índice (tenant_id, organization_unit_id, settlement_id). Toda consulta filtra por tenant_id. |
| (c) | Nueva tabla `transaction_debts` | Pagos multi-cuota: `transactions` no referencia a `debts`. | transaction_id, debt_id, monto_aplicado; PK (transaction_id, debt_id). Permite pagos parciales si se aprueban (P-05). Inmutable. |
| (d) | Tipo de unidad genérico en `billing_units` | Distinguir DEPARTAMENTO / DEPOSITO / COCHERA sin tablas por rubro. | Opción 1: columna genérica `tipo_unidad` (VARCHAR validado por catálogo por rubro). Opción 2: `metadata_json.tipo` con índice GIN/expresión. Se recomienda opción 1 por filtrado e indexación. |
| (e) | Clasificación de cuota (ordinaria / extraordinaria) | Separar responsabilidades propietario / inquilino (P-01). | Campo genérico `debts.tipo_cuota` o clave en `detalle_items_json`; valores por catálogo del rubro. |
| (f) | Estados EN_PROCESO y asientos de extorno | Evitar doble cobro durante el pago; ledger inmutable. | Estado EN_PROCESO en `debts`; en `transactions`, campo `tipo_asiento` (CARGO, EXTORNO) y `transaccion_origen_id` para asientos inversos. |
| (g) | Tabla de eventos de webhook | Idempotencia del procesamiento de webhooks. | `webhook_events`: provider, event_id (único), firma_valida, payload_json, procesado_en. Rechaza duplicados. |

### 10.3 Esquema SQL ilustrativo de los ajustes (PROPUESTA)

```sql
-- PROPUESTA – pendiente de aprobación (ilustrativo, PostgreSQL 16+)
ALTER TABLE billing_units ADD COLUMN tipo_unidad VARCHAR(30) NOT NULL DEFAULT 'GENERICO';
ALTER TABLE transactions
  ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id),
  ADD COLUMN organization_unit_id UUID NOT NULL REFERENCES organization_units(id),
  ADD COLUMN settlement_id UUID NULL REFERENCES settlements(id),
  ADD COLUMN idempotency_key VARCHAR(80) NOT NULL UNIQUE,
  ADD COLUMN tipo_asiento VARCHAR(10) NOT NULL DEFAULT 'CARGO',
  ADD COLUMN transaccion_origen_id UUID NULL REFERENCES transactions(id);
CREATE INDEX ix_tx_liquidacion ON transactions (tenant_id, organization_unit_id, settlement_id);
CREATE TABLE transaction_debts (
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  debt_id UUID NOT NULL REFERENCES debts(id),
  monto_aplicado NUMERIC(14,2) NOT NULL CHECK (monto_aplicado > 0),
  PRIMARY KEY (transaction_id, debt_id)
);
-- Ledger inmutable: revocar DELETE/UPDATE de montos al rol de aplicación
-- y/o trigger que rechace UPDATE de columnas de monto en transactions y settlements.
```

Los nombres de columnas y tipos son ilustrativos y están sujetos a revisión técnica. Ninguno de estos ajustes introduce conceptos propios del rubro inmobiliario en el core.

---

## 11. API REST v1 relevante al residente

### 11.1 Endpoints de FSD-001

| Método | Ruta | Rol | Uso en este FSD |
|---|---|---|---|
| POST | `/api/v1/auth/login` | Auth | RF-R-01: credenciales u OTP WhatsApp/SMS. |
| GET | `/api/v1/payer/units` | Pagador | RF-R-02, RF-R-04: unidades vinculadas con tipo, metadata y rol. |
| GET | `/api/v1/payer/units/{id}/debts` | Pagador | RF-R-03, RF-R-05: cuotas PENDIENTE / VENCIDO de la unidad. |
| GET | `/api/v1/payer/units/{id}/transactions` | Pagador | RF-R-06: historial, total y PDFs. |
| POST | `/api/v1/payer/payment-methods` | Pagador | RF-R-09, RF-R-11, RF-R-12: guarda token_id y flag de débito. |
| DELETE | `/api/v1/payer/payment-methods/{id}` | Pagador | RF-R-11: desvincula tarjeta (baja lógica en la billetera). |
| POST | `/api/v1/payments/checkout` | Motor de pagos | RF-R-07 a RF-R-10: cobro multi-cuota. |
| POST | `/api/v1/webhooks/gateway/{provider}` | Motor de pagos | RF-R-13: confirmación con firma HMAC (fuente de verdad). |
| POST | `/api/v1/tenant/units/bulk-import` | Admin B2B | RF-S-02: importación .xlsx del padrón. |
| POST | `/api/v1/tenant/debts/generate` | Admin B2B | RF-S-03: emisión mensual por edificio. |
| GET | `/api/v1/tenant/settlements` | Admin B2B | RF-S-05, RF-S-06: liquidaciones, saldos y anexos. |

### 11.2 Endpoints nuevos (PROPUESTA – pendiente de aprobación)

| Método | Ruta | Rol | Propósito |
|---|---|---|---|
| GET | `/api/v1/payer/properties` | Pagador | Vista consolidada «Mis propiedades»: edificios → tipos → unidades con saldos y totales. |
| GET | `/api/v1/payer/debts?scope=all` | Pagador | Cuotas pendientes consolidadas de todas las unidades (dashboard). |
| GET | `/api/v1/payer/debts/{id}/notice.pdf` | Pagador | Descarga del aviso de cobranza en PDF. |
| GET | `/api/v1/payer/transactions/{id}/receipt.pdf` | Pagador | Descarga del comprobante de recaudación en PDF. |
| GET | `/api/v1/payer/pay-links/{token}` | Público (token firmado) | Resolver link de WhatsApp hacia el checkout de una cuota. |
| GET | `/api/v1/payments/{id}/status` | Pagador | Consulta del estado del pago (polling de la PWA mientras llega el webhook). |
| POST | `/api/v1/payer/units/{id}/data-issues` | Pagador | Reportar dato incorrecto de una unidad a la administradora. |

### 11.3 Ejemplo de contrato: POST /api/v1/payments/checkout (ilustrativo)

```http
POST /api/v1/payments/checkout
Authorization: Bearer <token>
Idempotency-Key: 7f1c2e9a-... (único por intento de pago)

{
  "debt_ids": ["d-001", "d-002"],
  "metodo_pago": "YAPE",            // YAPE | CARD | CIP
  "yape": { "celular": "9XXXXXXXX", "otp": "123456" },
  "card": { "payment_method_id": null, "token_id": null, "guardar": false }
}
```

```http
202 Accepted
{ "transaction_id": "t-123", "estado": "EN_PROCESO", "monto_total": "<calculado en backend>" }
```

> **Nota:** el backend ignora cualquier monto enviado por el cliente y responde 202 (no 200 «pagado»), porque la confirmación llega por webhook.

---

## 12. Reglas críticas no negociables

| # | Regla | Aplicación en Tranky |
|---|---|---|
| 1 | Idempotencia estricta | Cada intento de cargo a la pasarela lleva un `Idempotency-Key` único; reintentos de red no generan doble cobro. Los webhooks se procesan de forma idempotente por `event_id`. |
| 2 | Bloqueo pesimista | `SELECT ... FOR UPDATE` sobre cada cuota al iniciar el pago, para impedir que propietario e inquilino (u otro pagador) paguen la misma cuota simultáneamente. |
| 3 | Ledger inmutable | Prohibido DELETE o sobrescribir montos en `transactions` y `settlements`. Correcciones y extornos se registran como asientos inversos. |
| 4 | Webhook con HMAC como fuente de verdad | Una cuota solo pasa a PAGADO tras validar la firma HMAC del webhook. La redirección del navegador nunca confirma un pago. |
| 5 | Datos de tarjeta solo tokenizados en frontend | PAN y CVV se capturan con el SDK de la pasarela; el backend solo maneja `token_id`, marca y últimos 4 dígitos (PCI-DSS). |
| 6 | Aislamiento multi-tenant | Toda consulta filtra por `tenant_id`; un residente con unidades en varias administradoras ve cada unidad dentro de su tenant sin mezclar datos. |
| 7 | Pasarelas detrás de patrón Strategy | Culqi, Niubiz, Izipay y Yape se integran mediante una interfaz común (cobrar, consultar, extornar, validar webhook); agregar una pasarela no modifica el core. |
| 8 | Core agnóstico | Ninguna tabla, columna o lógica core atada al rubro; el vocabulario inmobiliario vive en presentación y configuración. |

---

## 13. Requerimientos no funcionales

| ID | Categoría | Requerimiento |
|---|---|---|
| RNF-01 | Stack backend | NestJS (TypeScript) o FastAPI, arquitectura modular limpia (dominio, aplicación, infraestructura); adaptadores de pasarela con patrón Strategy. |
| RNF-02 | Datos | PostgreSQL 16+ (ACID, JSONB para `metadata_json` y `detalle_items_json`); migraciones versionadas. |
| RNF-03 | Colas | Redis + BullMQ para WhatsApp masivo, generación de PDFs, cargos recurrentes y reintentos de webhooks. |
| RNF-04 | Frontend | Tranky como PWA en React/Next.js, mobile-first, instalable opcionalmente; pago desde link de WhatsApp en alrededor de 15 s sin instalar app. |
| RNF-05 | Seguridad | TLS en todo el tráfico; contraseñas con hash robusto; validación HMAC en webhooks; tokens de sesión con expiración; rate limiting en login, OTP y checkout; registro de auditoría de accesos y cambios; cumplimiento PCI-DSS por tokenización (alcance reducido) y Ley N.° 29733 de Protección de Datos Personales. |
| RNF-06 | Rendimiento | Tiempos de respuesta objetivo para dashboard, listados y checkout: a definir. Paginación en historial e índices por `tenant_id`. |
| RNF-07 | Disponibilidad | Meta de disponibilidad (SLA) y ventanas de mantenimiento: a definir. Los webhooks deben tolerar caídas temporales mediante reintentos de la pasarela y cola interna. |
| RNF-08 | Escalabilidad | Emisión masiva y notificaciones asíncronas; capacidad objetivo (edificios, unidades, pagos concurrentes): a definir. |
| RNF-09 | Observabilidad | Logs estructurados con correlation-id e `Idempotency-Key`, métricas de pagos exitosos/fallidos por pasarela, alertas ante webhooks con firma inválida. |
| RNF-10 | Usabilidad | Interfaz en español (Perú), montos con formato S/ y US$, accesible en móviles de gama media; lenguaje del rubro (departamento, cochera, depósito). |
| RNF-11 | Respaldo y recuperación | Backups con recuperación a un punto en el tiempo; RPO/RTO a definir. |

---

## 14. Supuestos y decisiones a validar durante la implementación

### 14.1 Supuestos
- El padrón de unidades y residentes lo mantiene la administradora; el residente no lo modifica.
- Cada unidad (departamento, depósito o cochera) es un `billing_unit` independiente que puede tener sus propias cuotas.
- Una operación de pago agrupa cuotas de un mismo edificio y moneda (a validar).
- La regla de mora se configura por edificio (`organization_unit`).
- Las tarifas de comisión, tasas de mora e IGV se parametrizan; este documento no fija valores.
- El MVP se desarrolla en 8 semanas (4 sprints de 2 semanas), según FSD-001.

### 14.2 Decisiones a validar durante la implementación
Por indicación de Pedro Coronado, los siguientes puntos se resolverán en la práctica durante la implementación (con datos reales de los primeros edificios y retroalimentación de residentes y administradoras). Mientras tanto, el diseño los deja parametrizables por edificio o configuración, sin fijar valores en código.

| ID | Decisión a validar | Impacto |
|---|---|---|
| P-01 | ¿Quién paga qué entre propietario e inquilino? ¿Las cuotas ordinarias las paga el inquilino y las extraordinarias el propietario? ¿El inquilino ve las cuotas extraordinarias? | Visibilidad y permisos (RF-R-03, RF-R-05), clasificación de cuotas (ajuste e). |
| P-02 | ¿El inquilino puede registrar o ver las unidades del propietario (p. ej. el depósito o la cochera no arrendados)? | Mis propiedades (RF-R-04), matriz de permisos. |
| P-03 | ¿Cuál es la regla de mora por edificio: tipo (interés diario o penalidad fija), tasa o monto, días de gracia, tope? ¿Se congela la mora durante EN_PROCESO? | Cron 00:01 (RF-S-04), cálculo de `monto_mora`. |
| P-04 | ¿El depósito y la cochera se facturan en cuota separada o dentro de la cuota del departamento? | Emisión (RF-S-03), presentación en Mis propiedades y cuotas. |
| P-05 | ¿Se permiten pagos parciales de una cuota? ¿Se exige pagar primero la cuota más antigua? | Checkout (RF-R-07), `transaction_debts.monto_aplicado`. |
| P-06 | ¿Quién asume la comisión por defecto: el pagador o el tenant (administradora/junta)? ¿Puede variar por edificio o método de pago? | Resumen del checkout, liquidación (`config_comision_json`). |
| P-07 | ¿Cuáles son los principios de contabilidad multi-tenant (cuentas, asientos, conciliación, tratamiento del IGV sobre comisiones de pasarela vs. recaudadora)? | Settlement engine, facturación, reportes contables. |
| P-08 | ¿Cuál es el contenido de cada uno de los 4 sprints del MVP (8 semanas, 2 semanas c/u)? | Planificación; no se detalla en este documento. |

---

## 15. Checklist de cumplimiento (FSD-001)

| ✓ | Criterio | Cómo se cumple en FSD-002 |
|---|---|---|
| ☐ | Ninguna tabla, columna o lógica core atada a un rubro. | Tipo de unidad genérico / `metadata_json`; mapeo en sección 5.1. |
| ☐ | Consultas filtradas por tenant. | Ajuste (b) y regla crítica 6. |
| ☐ | Idempotency-Key en cada cargo. | RF-R-07, flujo 8.1, regla 1. |
| ☐ | SELECT ... FOR UPDATE al pagar cuotas. | RF-R-07, flujo 8.1, regla 2. |
| ☐ | Sin DELETE ni UPDATE de montos en transactions/settlements. | Ajuste (f), regla 3, extornos como asientos inversos. |
| ☐ | Webhooks validan HMAC y son la fuente de verdad del pago. | RF-R-13, flujo 8.1, regla 4. |
| ☐ | Datos de tarjeta solo tokenizados en frontend. | RF-R-09, RF-R-11, flujo 8.3, regla 5. |
| ☐ | IGV calculado solo sobre la comisión de recaudación. | RF-S-07 y fórmula 7.1. |
| ☐ | Pasarelas aisladas detrás de una interfaz Strategy. | RNF-01 y regla 7. |

— Fin del documento —
