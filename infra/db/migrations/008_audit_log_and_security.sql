-- 008_audit_log_and_security.sql
-- Append-only tamper-evident hash-chained audit ledger, advisory locking, and verification function

-- 1. Audit Log Table
CREATE TABLE IF NOT EXISTS audit_log (
    seq BIGSERIAL PRIMARY KEY,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    ts TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    actor_id UUID NOT NULL,
    actor_role VARCHAR(50) NOT NULL,
    actor_ip INET,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    application_id UUID,
    old_state VARCHAR(50),
    new_state VARCHAR(50),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ai_assisted BOOLEAN NOT NULL DEFAULT FALSE,
    prev_hash BYTEA,
    hash BYTEA
);

-- Composite indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_audit_log_app_seq ON audit_log(application_id, seq);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_ts ON audit_log(actor_id, ts);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

-- 2. Immutability Trigger: Prohibit UPDATE and DELETE
CREATE OR REPLACE FUNCTION fn_prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit log is strictly append-only. UPDATE, DELETE, and TRUNCATE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_immutable
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION fn_prevent_audit_log_mutation();

-- 3. Hash Chaining Trigger on BEFORE INSERT
-- Uses pg_advisory_xact_lock to ensure serializable, unbroken hash chain under high concurrency (e.g. 200 concurrent inserts)
CREATE OR REPLACE FUNCTION fn_compute_audit_hash()
RETURNS TRIGGER AS $$
DECLARE
    last_hash BYTEA;
    canonical_payload TEXT;
    genesis_hash BYTEA := decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex');
BEGIN
    -- Acquire exclusive transaction-level advisory lock on audit ledger sequence
    PERFORM pg_advisory_xact_lock(987654321);

    -- Retrieve previous hash in chain
    SELECT hash INTO last_hash
    FROM audit_log
    ORDER BY seq DESC
    LIMIT 1;

    IF last_hash IS NULL THEN
        NEW.prev_hash := genesis_hash;
    ELSE
        NEW.prev_hash := last_hash;
    END IF;

    -- Canonical JSON text of row attributes
    canonical_payload := json_build_object(
        'id', NEW.id,
        'actor_id', NEW.actor_id,
        'actor_role', NEW.actor_role,
        'action', NEW.action,
        'entity_type', NEW.entity_type,
        'entity_id', NEW.entity_id,
        'application_id', NEW.application_id,
        'old_state', NEW.old_state,
        'new_state', NEW.new_state,
        'payload', NEW.payload,
        'ai_assisted', NEW.ai_assisted
    )::text;

    -- SHA-256 (prev_hash || canonical_payload)
    NEW.hash := digest(NEW.prev_hash || convert_to(canonical_payload, 'UTF8'), 'sha256');

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_hash_chain
BEFORE INSERT ON audit_log
FOR EACH ROW EXECUTE FUNCTION fn_compute_audit_hash();

-- 4. Audit Chain Verification Function
-- Returns the first broken sequence number, or NULL if chain is completely valid
CREATE OR REPLACE FUNCTION fn_verify_audit_chain(from_seq BIGINT DEFAULT 1, to_seq BIGINT DEFAULT NULL)
RETURNS BIGINT AS $$
DECLARE
    rec RECORD;
    prev_expected_hash BYTEA := NULL;
    calculated_hash BYTEA;
    canonical_payload TEXT;
    genesis_hash BYTEA := decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex');
BEGIN
    IF to_seq IS NULL THEN
        SELECT COALESCE(MAX(seq), 0) INTO to_seq FROM audit_log;
    END IF;

    FOR rec IN
        SELECT *
        FROM audit_log
        WHERE seq >= from_seq AND seq <= to_seq
        ORDER BY seq ASC
    LOOP
        -- Check prev_hash link
        IF rec.seq = 1 THEN
            IF rec.prev_hash != genesis_hash THEN
                RETURN rec.seq;
            END IF;
        ELSE
            IF prev_expected_hash IS NOT NULL AND rec.prev_hash != prev_expected_hash THEN
                RETURN rec.seq;
            END IF;
        END IF;

        -- Recompute SHA-256 hash
        canonical_payload := json_build_object(
            'id', rec.id,
            'actor_id', rec.actor_id,
            'actor_role', rec.actor_role,
            'action', rec.action,
            'entity_type', rec.entity_type,
            'entity_id', rec.entity_id,
            'application_id', rec.application_id,
            'old_state', rec.old_state,
            'new_state', rec.new_state,
            'payload', rec.payload,
            'ai_assisted', rec.ai_assisted
        )::text;

        calculated_hash := digest(rec.prev_hash || convert_to(canonical_payload, 'UTF8'), 'sha256');

        IF calculated_hash != rec.hash THEN
            RETURN rec.seq;
        END IF;

        prev_expected_hash := rec.hash;
    END LOOP;

    RETURN NULL; -- Chain is completely unbroken and valid
END;
$$ LANGUAGE plpgsql;
