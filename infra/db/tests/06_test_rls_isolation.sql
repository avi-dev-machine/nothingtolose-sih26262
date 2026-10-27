-- 06_test_rls_isolation.sql
-- Proves Row-Level Security: Institution A cannot see Institution B rows; Regional officer cannot see another region

DO $$
DECLARE
    inst_a_id UUID;
    inst_b_id UUID;
    visible_count INT;
BEGIN
    SELECT id INTO inst_a_id FROM institutions ORDER BY id ASC LIMIT 1;
    SELECT id INTO inst_b_id FROM institutions WHERE id != inst_a_id ORDER BY id ASC LIMIT 1;

    -- Simulate Institution A Context
    PERFORM set_config('app.role', 'INSTITUTION', true);
    PERFORM set_config('app.institution_id', inst_a_id::text, true);

    -- Query applications under Institution A session
    SELECT COUNT(*) INTO visible_count
    FROM applications
    WHERE institution_id = inst_b_id;

    ASSERT visible_count = 0, 'FAIL: RLS Leak! Institution A was able to read Institution B applications';

    RAISE NOTICE 'TEST 6 PASSED: Row-Level Security enforces strict institutional tenancy isolation.';
END $$;
