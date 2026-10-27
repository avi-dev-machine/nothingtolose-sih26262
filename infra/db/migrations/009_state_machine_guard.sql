-- 009_state_machine_guard.sql
-- Database-level state machine transition validator, optimistic lock version bumper, and separation of duties

-- 1. State Machine Guard Trigger on applications
CREATE OR REPLACE FUNCTION fn_enforce_state_machine_guard()
RETURNS TRIGGER AS $$
DECLARE
    transition_valid BOOLEAN := FALSE;
    def_id UUID;
    acting_user_id TEXT;
    conflict_user UUID;
BEGIN
    -- Only validate when state is changing
    IF OLD.state IS DISTINCT FROM NEW.state THEN
        -- Find active workflow definition for this track
        SELECT id INTO def_id
        FROM workflow_definitions
        WHERE track = NEW.track AND active = TRUE
        ORDER BY version DESC
        LIMIT 1;

        -- Verify transition existence
        IF def_id IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1
                FROM workflow_transitions
                WHERE definition_id = def_id
                  AND from_state = OLD.state
                  AND to_state = NEW.state
            ) INTO transition_valid;
        END IF;

        IF NOT transition_valid THEN
            RAISE EXCEPTION 'Illegal state transition from % to % for track %', OLD.state, NEW.state, NEW.track;
        END IF;

        -- Separation of duties check: Scrutiny clearance vs Deficiency raiser
        IF NEW.state = 'SCRUTINY_CLEARED' THEN
            acting_user_id := current_setting('app.user_id', true);
            IF acting_user_id IS NOT NULL AND acting_user_id != '' THEN
                SELECT raised_by INTO conflict_user
                FROM deficiencies
                WHERE application_id = NEW.id
                  AND raised_by = acting_user_id::UUID
                LIMIT 1;

                IF conflict_user IS NOT NULL THEN
                    RAISE EXCEPTION 'Separation of duties violation: Officer who raised deficiencies cannot clear scrutiny for application %', NEW.id;
                END IF;
            END IF;
        END IF;

        -- Separation of duties check: Committee final decider cannot be scrutiny officer
        IF NEW.state IN ('APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'COMPLIANCE_REQUIRED') THEN
            acting_user_id := current_setting('app.user_id', true);
            IF acting_user_id IS NOT NULL AND acting_user_id != '' THEN
                IF OLD.current_owner_id = acting_user_id::UUID AND OLD.current_owner_role = 'SCRUTINY_OFFICER' THEN
                    RAISE EXCEPTION 'Separation of duties violation: Scrutiny officer cannot make final committee decision for application %', NEW.id;
                END IF;
            END IF;
        END IF;

        -- Bump optimistic locking version & record timestamp
        NEW.version := OLD.version + 1;
        NEW.state_entered_at := NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_applications_state_guard
BEFORE UPDATE ON applications
FOR EACH ROW EXECUTE FUNCTION fn_enforce_state_machine_guard();
