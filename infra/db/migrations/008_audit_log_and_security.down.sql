-- 008_audit_log_and_security.down.sql
DROP FUNCTION IF EXISTS fn_verify_audit_chain CASCADE;
DROP TRIGGER IF EXISTS trg_audit_log_hash_chain ON audit_log;
DROP FUNCTION IF EXISTS fn_compute_audit_hash CASCADE;
DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
DROP FUNCTION IF EXISTS fn_prevent_audit_log_mutation CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
