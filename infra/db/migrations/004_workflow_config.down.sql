-- 004_workflow_config.down.sql
DROP TABLE IF EXISTS rule_definitions CASCADE;
DROP TABLE IF EXISTS aph_clauses CASCADE;
DROP TABLE IF EXISTS document_types CASCADE;
DROP TABLE IF EXISTS business_calendar CASCADE;
DROP TABLE IF EXISTS escalation_rules CASCADE;
DROP TABLE IF EXISTS sla_policies CASCADE;
DROP TABLE IF EXISTS workflow_transitions CASCADE;
DROP TABLE IF EXISTS workflow_definitions CASCADE;
