-- 009_state_machine_guard.down.sql
DROP TRIGGER IF EXISTS trg_applications_state_guard ON applications;
DROP FUNCTION IF EXISTS fn_enforce_state_machine_guard CASCADE;
