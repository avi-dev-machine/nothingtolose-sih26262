-- 03_test_audit_immutability.sql
-- Proves UPDATE and DELETE on audit_log fail unconditionally

DO $$
DECLARE
    test_seq BIGINT;
    update_caught BOOLEAN := FALSE;
    delete_caught BOOLEAN := FALSE;
BEGIN
    SELECT seq INTO test_seq FROM audit_log LIMIT 1;
    IF test_seq IS NULL THEN
        INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, payload)
        VALUES (gen_random_uuid(), 'ADMIN', 'TEST_EVENT', 'TEST', gen_random_uuid(), '{}'::jsonb)
        RETURNING seq INTO test_seq;
    END IF;

    -- Test UPDATE prohibition
    BEGIN
        UPDATE audit_log SET action = 'TAMPERED_ACTION' WHERE seq = test_seq;
    EXCEPTION
        WHEN OTHERS THEN
            update_caught := TRUE;
    END;

    -- Test DELETE prohibition
    BEGIN
        DELETE FROM audit_log WHERE seq = test_seq;
    EXCEPTION
        WHEN OTHERS THEN
            delete_caught := TRUE;
    END;

    ASSERT update_caught = TRUE, 'FAIL: Database permitted an UPDATE on audit_log';
    ASSERT delete_caught = TRUE, 'FAIL: Database permitted a DELETE on audit_log';

    RAISE NOTICE 'TEST 3 PASSED: Audit ledger is strictly append-only. UPDATE and DELETE rejected.';
END $$;
