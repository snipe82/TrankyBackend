-- Regla crítica 3 (FSD-002 §12): ledger inmutable. Las correcciones son asientos inversos.

CREATE FUNCTION forbid_ledger_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'DELETE/TRUNCATE prohibido en % (ledger inmutable)', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION forbid_update() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'UPDATE prohibido en % (registro inmutable)', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_transactions_update() RETURNS TRIGGER AS $$
BEGIN
  IF ROW(OLD.codigo_operacion, OLD.tenant_id, OLD.organization_unit_id, OLD.payer_id, OLD.tipo_asiento,
         OLD.transaccion_origen_id, OLD.metodo_pago, OLD.pasarela, OLD.moneda, OLD.monto_deuda_cubierta,
         OLD.comision_pasarela, OLD.comision_recaudadora, OLD.igv_comision, OLD.monto_total_cobrado,
         OLD.monto_neto_a_liquidar, OLD.comision_asumida_por, OLD.idempotency_key, OLD.request_hash)
     IS DISTINCT FROM
     ROW(NEW.codigo_operacion, NEW.tenant_id, NEW.organization_unit_id, NEW.payer_id, NEW.tipo_asiento,
         NEW.transaccion_origen_id, NEW.metodo_pago, NEW.pasarela, NEW.moneda, NEW.monto_deuda_cubierta,
         NEW.comision_pasarela, NEW.comision_recaudadora, NEW.igv_comision, NEW.monto_total_cobrado,
         NEW.monto_neto_a_liquidar, NEW.comision_asumida_por, NEW.idempotency_key, NEW.request_hash) THEN
    RAISE EXCEPTION 'Montos e identidad de transactions son inmutables; registre un asiento de extorno'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.settlement_id IS NOT NULL AND NEW.settlement_id IS DISTINCT FROM OLD.settlement_id THEN
    RAISE EXCEPTION 'settlement_id ya asignado; no se puede sobrescribir'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.pasarela_tx_id IS NOT NULL AND NEW.pasarela_tx_id IS DISTINCT FROM OLD.pasarela_tx_id THEN
    RAISE EXCEPTION 'pasarela_tx_id ya asignado; no se puede sobrescribir'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.estado IN ('EXITOSO', 'FALLIDO', 'REVERSADO') AND NEW.estado IS DISTINCT FROM OLD.estado
     AND NOT (OLD.estado = 'EXITOSO' AND NEW.estado = 'REVERSADO') THEN
    RAISE EXCEPTION 'Transición de estado no permitida en transactions: % -> %', OLD.estado, NEW.estado
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_settlements_update() RETURNS TRIGGER AS $$
BEGIN
  IF ROW(OLD.tenant_id, OLD.organization_unit_id, OLD.fecha_corte, OLD.moneda, OLD.monto_bruto_recaudado,
         OLD.total_comisiones_retenidas, OLD.monto_neto_transferido)
     IS DISTINCT FROM
     ROW(NEW.tenant_id, NEW.organization_unit_id, NEW.fecha_corte, NEW.moneda, NEW.monto_bruto_recaudado,
         NEW.total_comisiones_retenidas, NEW.monto_neto_transferido) THEN
    RAISE EXCEPTION 'Montos de settlements son inmutables; registre un ajuste'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transactions_no_delete BEFORE DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_delete();
CREATE TRIGGER trg_transactions_no_truncate BEFORE TRUNCATE ON transactions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_ledger_delete();
CREATE TRIGGER trg_transactions_guard BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION guard_transactions_update();

CREATE TRIGGER trg_settlements_no_delete BEFORE DELETE ON settlements
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_delete();
CREATE TRIGGER trg_settlements_no_truncate BEFORE TRUNCATE ON settlements
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_ledger_delete();
CREATE TRIGGER trg_settlements_guard BEFORE UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION guard_settlements_update();

CREATE TRIGGER trg_tx_debts_no_delete BEFORE DELETE ON transaction_debts
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_delete();
CREATE TRIGGER trg_tx_debts_no_truncate BEFORE TRUNCATE ON transaction_debts
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_ledger_delete();
CREATE TRIGGER trg_tx_debts_no_update BEFORE UPDATE ON transaction_debts
  FOR EACH ROW EXECUTE FUNCTION forbid_update();

CREATE TRIGGER trg_webhook_events_no_delete BEFORE DELETE ON webhook_events
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_delete();

CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_delete();
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_update();

CREATE TRIGGER trg_tenants_touch BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_org_units_touch BEFORE UPDATE ON organization_units FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_billing_units_touch BEFORE UPDATE ON billing_units FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_payers_touch BEFORE UPDATE ON payers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_upr_touch BEFORE UPDATE ON unit_payer_relations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_admins_touch BEFORE UPDATE ON tenant_admin_users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_debts_touch BEFORE UPDATE ON debts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_vault_touch BEFORE UPDATE ON payment_methods_vault FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
