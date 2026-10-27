-- 05_test_dual_clock_exclusion.sql
-- Proves two open clocks for the same application are strictly rejected

DO $$
DECLARE
    test_inst_id UUID;
    test_app_id UUID;
    caught_exception BOOLEAN := FALSE;
BEGIN
    SELECT id INTO test_inst_id FROM institutions LIMIT 1;

    INSERT INTO applications (ref_no, institution_id, track, state)
    VALUES ('TEST-APP-CLOCK-EXCLUSION', test_inst_id, 'A', 'UNDER_SCRUTINY')
    RETURNING id INTO test_app_id;

    -- Open AICTE Clock
    INSERT INTO clock_events (application_id, clock, started_at, stopped_at, holder_role, state_ref)
    VALUES (test_app_id, 'AICTE', NOW(), NULL, 'SCRUTINY_OFFICER', 'UNDER_SCRUTINY');

    BEGIN
        -- Attempt to open simultaneous INSTITUTION clock for the same application
        INSERT INTO clock_events (application_id, clock, started_at, stopped_at, holder_role, state_ref)
        VALUES (test_app_id, 'INSTITUTION', NOW(), NULL, 'INSTITUTION', 'UNDER_SCRUTINY');
    EXCEPTION
        WHEN OTHERS THEN
            caught_exception := TRUE;
    END;

    -- Cleanup
    DELETE FROM clock_events WHERE application_id = test_app_id;
    DELETE FROM applications WHERE id = test_app_id;

    ASSERT caught_exception = TRUE, 'FAIL: Database permitted two simultaneously active open clocks for the same application';

    RAISE NOTICE 'TEST 5 PASSED: Exclusion constraint strictly rejected simultaneous open clocks.';
END $$;
