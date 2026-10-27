-- 02_test_state_machine_guard.sql
-- Proves illegal state transitions are rejected by database triggers

DO $$
DECLARE
    test_inst_id UUID;
    test_app_id UUID;
    caught_exception BOOLEAN := FALSE;
BEGIN
    SELECT id INTO test_inst_id FROM institutions LIMIT 1;

    INSERT INTO applications (ref_no, institution_id, track, state)
    VALUES ('TEST-APP-STATE-MACHINE', test_inst_id, 'A', 'DRAFT')
    RETURNING id INTO test_app_id;

    BEGIN
        -- Illegal transition: DRAFT cannot jump directly to APPROVED
        UPDATE applications
        SET state = 'APPROVED'
        WHERE id = test_app_id;
    EXCEPTION
        WHEN OTHERS THEN
            caught_exception := TRUE;
    END;

    -- Cleanup test application
    DELETE FROM applications WHERE id = test_app_id;

    ASSERT caught_exception = TRUE, 'FAIL: Database permitted an illegal state transition from DRAFT to APPROVED';

    RAISE NOTICE 'TEST 2 PASSED: State machine guard trigger strictly rejected illegal state transition.';
END $$;
