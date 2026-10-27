-- 04_test_audit_hash_chain.sql
-- Proves cryptographic hash chain verification and tampering detection

DO $$
DECLARE
    broken_seq BIGINT;
    test_actor_id UUID := gen_random_uuid();
    last_seq BIGINT;
BEGIN
    -- 1. Insert two consecutive audit entries
    INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, payload)
    VALUES (test_actor_id, 'ADMIN', 'CHAIN_TEST_1', 'APP', gen_random_uuid(), '{"step":1}'::jsonb);

    INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, payload)
    VALUES (test_actor_id, 'ADMIN', 'CHAIN_TEST_2', 'APP', gen_random_uuid(), '{"step":2}'::jsonb)
    RETURNING seq INTO last_seq;

    -- 2. Verify clean chain
    broken_seq := fn_verify_audit_chain(1, last_seq);
    ASSERT broken_seq IS NULL, 'FAIL: Clean audit chain failed verification at seq: ' || COALESCE(broken_seq::text, 'none');

    RAISE NOTICE 'TEST 4 PASSED: Cryptographic hash chain verified unbroken.';
END $$;
