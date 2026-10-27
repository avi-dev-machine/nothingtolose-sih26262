-- 07_test_idempotent_alerts.sql
-- Proves duplicate compliance alerts are rejected by unique constraint

DO $$
DECLARE
    test_item_id UUID;
    caught_exception BOOLEAN := FALSE;
BEGIN
    SELECT id INTO test_item_id FROM compliance_items LIMIT 1;

    INSERT INTO compliance_alerts (item_id, threshold_days)
    VALUES (test_item_id, 30);

    BEGIN
        -- Attempt to insert exact duplicate alert for the same threshold
        INSERT INTO compliance_alerts (item_id, threshold_days)
        VALUES (test_item_id, 30);
    EXCEPTION
        WHEN OTHERS THEN
            caught_exception := TRUE;
    END;

    DELETE FROM compliance_alerts WHERE item_id = test_item_id AND threshold_days = 30;

    ASSERT caught_exception = TRUE, 'FAIL: Database permitted duplicate compliance alert for the same threshold';

    RAISE NOTICE 'TEST 7 PASSED: Idempotent alerts guaranteed by unique index constraint.';
END $$;
