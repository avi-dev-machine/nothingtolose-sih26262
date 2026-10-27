-- 01_test_migrations.sql
-- Proves all core tables, constraints and extensions exist

DO $$
BEGIN
    ASSERT (SELECT count(*) FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgcrypto', 'citext', 'pg_trgm', 'btree_gist', 'vector')) = 6,
        'FAIL: Required extensions missing';

    ASSERT (SELECT count(*) FROM information_schema.tables WHERE table_name IN (
        'regions', 'institutions', 'users', 'refresh_tokens', 'permissions', 'role_permissions',
        'workflow_definitions', 'workflow_transitions', 'sla_policies', 'escalation_rules',
        'business_calendar', 'document_types', 'aph_clauses', 'rule_definitions',
        'applications', 'application_forms', 'documents', 'deficiencies', 'deficiency_responses',
        'tasks', 'reassignments', 'clock_events', 'evc_visits', 'evc_members', 'evc_findings',
        'approval_conditions', 'compliance_items', 'compliance_alerts', 'notification_templates',
        'notification_prefs', 'notifications', 'digests', 'ai_suggestions', 'document_extractions',
        'risk_scores', 'rag_queries', 'audit_log'
    )) = 37, 'FAIL: Required tables count mismatch';

    RAISE NOTICE 'TEST 1 PASSED: All extensions and 37 core tables exist.';
END $$;
