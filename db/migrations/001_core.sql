-- Modelo de datos de FSD-002 §10: tablas core (§10.1) + ajustes (a)–(g) (§10.2).
-- Ninguna tabla ni columna usa vocabulario del rubro inmobiliario.

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ruc VARCHAR(11) NOT NULL UNIQUE CHECK (ruc ~ '^\d{11}$'),
  razon_social VARCHAR(255) NOT NULL,
  nombre_comercial VARCHAR(255),
  rubro VARCHAR(30) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'SUSPENDIDO')),
  config_comision_json JSONB NOT NULL DEFAULT '{"tipo": "MIXTO", "fijo": 0, "porcentaje": 0, "asume": "PAGADOR"}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  banco VARCHAR(100) NOT NULL,
  cci VARCHAR(20) NOT NULL CHECK (cci ~ '^\d{20}$'),
  moneda CHAR(3) NOT NULL DEFAULT 'PEN' CHECK (moneda IN ('PEN', 'USD')),
  titular VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_bank_accounts_tenant ON bank_accounts (tenant_id);

-- config_json: reglas parametrizables por unidad organizativa (mora P-03, permisos por rol P-01/P-02).
CREATE TABLE organization_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  nombre VARCHAR(255) NOT NULL,
  direccion TEXT,
  moneda_base CHAR(3) NOT NULL DEFAULT 'PEN' CHECK (moneda_base IN ('PEN', 'USD')),
  bank_account_id UUID REFERENCES bank_accounts(id),
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id)
);
CREATE INDEX ix_org_units_tenant ON organization_units (tenant_id);

-- Ajuste (d): tipo_unidad genérico validado por catálogo del rubro en la capa de aplicación.
CREATE TABLE billing_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  organization_unit_id UUID NOT NULL,
  tipo_unidad VARCHAR(30) NOT NULL DEFAULT 'GENERICO',
  codigo_interno VARCHAR(50) NOT NULL,
  alias VARCHAR(255),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_unit_id, codigo_interno),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (organization_unit_id, tenant_id) REFERENCES organization_units (id, tenant_id)
);
CREATE INDEX ix_billing_units_tenant_org ON billing_units (tenant_id, organization_unit_id, tipo_unidad);

-- Los pagadores son personas globales: pueden tener unidades en varios tenants.
CREATE TABLE payers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_doc VARCHAR(10) NOT NULL CHECK (tipo_doc IN ('DNI', 'CE', 'RUC')),
  num_doc VARCHAR(20) NOT NULL,
  nombres VARCHAR(255) NOT NULL,
  apellidos VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  telefono_whatsapp VARCHAR(20),
  password_hash VARCHAR(255),
  intentos_fallidos INT NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tipo_doc, num_doc)
);

CREATE TABLE unit_payer_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  billing_unit_id UUID NOT NULL,
  payer_id UUID NOT NULL REFERENCES payers(id),
  rol VARCHAR(20) NOT NULL CHECK (rol IN ('PROPIETARIO', 'INQUILINO')),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (billing_unit_id, tenant_id) REFERENCES billing_units (id, tenant_id)
);
CREATE UNIQUE INDEX ux_upr_activa ON unit_payer_relations (billing_unit_id, payer_id, rol) WHERE activo;
CREATE INDEX ix_upr_payer ON unit_payer_relations (payer_id) WHERE activo;

CREATE TABLE tenant_admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nombres VARCHAR(255) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  intentos_fallidos INT NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ajustes (e) tipo_cuota y (f) estado EN_PROCESO.
CREATE TABLE debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  billing_unit_id UUID NOT NULL,
  payer_id UUID REFERENCES payers(id),
  periodo CHAR(7) NOT NULL CHECK (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  concepto_principal VARCHAR(255) NOT NULL,
  tipo_cuota VARCHAR(30) NOT NULL DEFAULT 'ORDINARIA',
  moneda CHAR(3) NOT NULL CHECK (moneda IN ('PEN', 'USD')),
  fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE NOT NULL,
  monto_base NUMERIC(14, 2) NOT NULL CHECK (monto_base >= 0),
  monto_mora NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (monto_mora >= 0),
  monto_descuento NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (monto_descuento >= 0),
  monto_total NUMERIC(14, 2) GENERATED ALWAYS AS (monto_base + monto_mora - monto_descuento) STORED,
  detalle_items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'VENCIDO', 'EN_PROCESO', 'PAGADO', 'ANULADO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (monto_base + monto_mora - monto_descuento >= 0),
  UNIQUE (billing_unit_id, periodo, concepto_principal),
  FOREIGN KEY (billing_unit_id, tenant_id) REFERENCES billing_units (id, tenant_id)
);
CREATE INDEX ix_debts_unit_estado ON debts (billing_unit_id, estado, fecha_vencimiento);
CREATE INDEX ix_debts_tenant_periodo ON debts (tenant_id, periodo, estado);

-- Solo tokens de pasarela: nunca PAN, CVV ni fecha de expiración (PCI-DSS).
CREATE TABLE payment_methods_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id UUID NOT NULL REFERENCES payers(id),
  pasarela VARCHAR(30) NOT NULL,
  tipo VARCHAR(20) NOT NULL DEFAULT 'CARD',
  token_id VARCHAR(255) NOT NULL,
  marca VARCHAR(30),
  ultimos_4_digitos CHAR(4) CHECK (ultimos_4_digitos ~ '^\d{4}$'),
  es_predeterminado BOOLEAN NOT NULL DEFAULT FALSE,
  debito_automatico_activo BOOLEAN NOT NULL DEFAULT FALSE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  desactivado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pasarela, token_id)
);
CREATE INDEX ix_vault_payer ON payment_methods_vault (payer_id) WHERE activo;
CREATE UNIQUE INDEX ux_vault_predeterminado ON payment_methods_vault (payer_id) WHERE activo AND es_predeterminado;

CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  organization_unit_id UUID NOT NULL,
  fecha_corte DATE NOT NULL,
  moneda CHAR(3) NOT NULL CHECK (moneda IN ('PEN', 'USD')),
  monto_bruto_recaudado NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_comisiones_retenidas NUMERIC(14, 2) NOT NULL DEFAULT 0,
  monto_neto_transferido NUMERIC(14, 2) NOT NULL DEFAULT 0,
  nro_operacion_bancaria VARCHAR(100),
  url_constancia_transferencia TEXT,
  url_factura_comision TEXT,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'PROCESANDO', 'LIQUIDADO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (organization_unit_id, tenant_id) REFERENCES organization_units (id, tenant_id)
);
CREATE INDEX ix_settlements_tenant ON settlements (tenant_id, organization_unit_id, fecha_corte);

CREATE TABLE pay_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash CHAR(64) NOT NULL UNIQUE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  debt_id UUID NOT NULL REFERENCES debts(id),
  payer_id UUID NOT NULL REFERENCES payers(id),
  expira_en TIMESTAMPTZ NOT NULL,
  usado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_pay_links_debt ON pay_links (debt_id);

-- Ajustes (a) settlement_id, (b) tenant/organization_unit, (f) tipo_asiento + transaccion_origen_id.
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_operacion VARCHAR(40) NOT NULL UNIQUE,
  tenant_id UUID NOT NULL,
  organization_unit_id UUID NOT NULL,
  payer_id UUID NOT NULL REFERENCES payers(id),
  tipo_asiento VARCHAR(10) NOT NULL DEFAULT 'CARGO' CHECK (tipo_asiento IN ('CARGO', 'EXTORNO')),
  transaccion_origen_id UUID REFERENCES transactions(id),
  origen VARCHAR(20) NOT NULL DEFAULT 'PORTAL' CHECK (origen IN ('PORTAL', 'PAY_LINK', 'DEBITO_AUTOMATICO', 'BACKOFFICE')),
  pay_link_id UUID REFERENCES pay_links(id),
  pasarela VARCHAR(30) NOT NULL,
  metodo_pago VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('YAPE', 'CARD', 'CIP')),
  payment_method_id UUID REFERENCES payment_methods_vault(id),
  moneda CHAR(3) NOT NULL CHECK (moneda IN ('PEN', 'USD')),
  monto_deuda_cubierta NUMERIC(14, 2) NOT NULL CHECK (monto_deuda_cubierta >= 0),
  comision_pasarela NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (comision_pasarela >= 0),
  comision_recaudadora NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (comision_recaudadora >= 0),
  igv_comision NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (igv_comision >= 0),
  monto_total_cobrado NUMERIC(14, 2) NOT NULL CHECK (monto_total_cobrado >= 0),
  monto_neto_a_liquidar NUMERIC(14, 2) NOT NULL,
  comision_asumida_por VARCHAR(10) NOT NULL CHECK (comision_asumida_por IN ('PAGADOR', 'TENANT')),
  estado VARCHAR(20) NOT NULL DEFAULT 'INICIADO' CHECK (estado IN ('INICIADO', 'EXITOSO', 'FALLIDO', 'REVERSADO')),
  motivo_fallo VARCHAR(255),
  pasarela_tx_id VARCHAR(255),
  idempotency_key VARCHAR(80) NOT NULL UNIQUE,
  request_hash CHAR(64) NOT NULL,
  expira_en TIMESTAMPTZ,
  fecha_pago TIMESTAMPTZ,
  settlement_id UUID REFERENCES settlements(id),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (tipo_asiento = 'CARGO' OR transaccion_origen_id IS NOT NULL),
  FOREIGN KEY (organization_unit_id, tenant_id) REFERENCES organization_units (id, tenant_id)
);
CREATE INDEX ix_tx_liquidacion ON transactions (tenant_id, organization_unit_id, settlement_id);
CREATE INDEX ix_tx_payer ON transactions (payer_id, created_at DESC);
CREATE INDEX ix_tx_iniciadas ON transactions (expira_en) WHERE estado = 'INICIADO';
CREATE UNIQUE INDEX ux_tx_pasarela ON transactions (pasarela, pasarela_tx_id) WHERE pasarela_tx_id IS NOT NULL;

-- Ajuste (c): pagos multi-cuota. Inmutable.
CREATE TABLE transaction_debts (
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  debt_id UUID NOT NULL REFERENCES debts(id),
  monto_aplicado NUMERIC(14, 2) NOT NULL CHECK (monto_aplicado > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (transaction_id, debt_id)
);
CREATE INDEX ix_tx_debts_debt ON transaction_debts (debt_id);

-- Ajuste (g): idempotencia de webhooks por (provider, event_id).
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(30) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  firma_valida BOOLEAN NOT NULL,
  payload_json JSONB NOT NULL,
  transaction_id UUID REFERENCES transactions(id),
  resultado VARCHAR(40),
  procesado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, event_id)
);

CREATE TABLE otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id UUID NOT NULL REFERENCES payers(id),
  codigo_hash CHAR(64) NOT NULL,
  canal VARCHAR(20) NOT NULL CHECK (canal IN ('WHATSAPP', 'SMS')),
  expira_en TIMESTAMPTZ NOT NULL,
  intentos INT NOT NULL DEFAULT 0,
  usado_en TIMESTAMPTZ,
  invalidado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_otp_payer ON otp_challenges (payer_id, created_at DESC);

-- Outbox de notificaciones (WhatsApp / email / SMS) con reintentos.
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  payer_id UUID REFERENCES payers(id),
  destinatario VARCHAR(255) NOT NULL,
  canal VARCHAR(20) NOT NULL CHECK (canal IN ('WHATSAPP', 'EMAIL', 'SMS')),
  plantilla VARCHAR(50) NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'ENVIADO', 'FALLIDO')),
  intentos INT NOT NULL DEFAULT 0,
  proximo_intento_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_error TEXT,
  enviado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_notifications_pendientes ON notifications (proximo_intento_en) WHERE estado = 'PENDIENTE';

CREATE TABLE data_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  billing_unit_id UUID NOT NULL,
  payer_id UUID NOT NULL REFERENCES payers(id),
  descripcion TEXT NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO', 'RESUELTO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (billing_unit_id, tenant_id) REFERENCES billing_units (id, tenant_id)
);
CREATE INDEX ix_data_issues_tenant ON data_issues (tenant_id, estado);

-- RNF-05: auditoría de accesos y cambios.
CREATE TABLE audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_tipo VARCHAR(20) NOT NULL,
  actor_id UUID,
  tenant_id UUID,
  accion VARCHAR(60) NOT NULL,
  entidad VARCHAR(60),
  entidad_id UUID,
  detalle_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip VARCHAR(64),
  correlation_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_audit_tenant ON audit_logs (tenant_id, created_at DESC);
