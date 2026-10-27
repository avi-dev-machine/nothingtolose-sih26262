-- 006_clocks_and_evc.sql
-- Clock events with partial unique and exclusion constraints, EVC visits, members, findings, and approval conditions

-- 1. Clock Events
CREATE TABLE IF NOT EXISTS clock_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    clock clock_owner_enum NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stopped_at TIMESTAMPTZ,
    holder_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    holder_role role_enum NOT NULL,
    state_ref application_state_enum NOT NULL,
    reason TEXT,
    stop_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_clock_period CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);

-- Partial UNIQUE index enforcing at most one open event per (application_id, clock)
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_open_clock_per_owner
ON clock_events (application_id, clock)
WHERE (stopped_at IS NULL);

-- Exclusion constraint using btree_gist: INSTITUTION and AICTE clocks are never open together (except while DRAFT)
ALTER TABLE clock_events
ADD CONSTRAINT ex_no_simultaneous_open_clocks
EXCLUDE USING gist (
    application_id WITH =,
    tstzrange(started_at, COALESCE(stopped_at, 'infinity')) WITH &&
)
WHERE (state_ref != 'DRAFT');

-- 2. EVC Visits
CREATE TABLE IF NOT EXISTS evc_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMPTZ NOT NULL,
    visit_due_at TIMESTAMPTZ NOT NULL,
    report_due_at TIMESTAMPTZ NOT NULL,
    status evc_visit_status_enum NOT NULL DEFAULT 'SCHEDULED',
    location TEXT NOT NULL,
    report_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    findings JSONB NOT NULL DEFAULT '{}'::jsonb,
    recommendation VARCHAR(50),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_evc_visits_updated_at
BEFORE UPDATE ON evc_visits
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 3. EVC Members
CREATE TABLE IF NOT EXISTS evc_members (
    visit_id UUID NOT NULL REFERENCES evc_visits(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role_in_visit VARCHAR(50) NOT NULL DEFAULT 'MEMBER',
    accepted_at TIMESTAMPTZ,
    PRIMARY KEY (visit_id, user_id)
);

-- 4. EVC Findings
CREATE TABLE IF NOT EXISTS evc_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID NOT NULL REFERENCES evc_visits(id) ON DELETE CASCADE,
    section VARCHAR(100) NOT NULL,
    observation TEXT NOT NULL,
    compliant BOOLEAN NOT NULL DEFAULT TRUE,
    clause_id UUID REFERENCES aph_clauses(id) ON DELETE SET NULL,
    photo_document_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    geo POINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Approval Conditions
CREATE TABLE IF NOT EXISTS approval_conditions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    compliance_item_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_approval_conditions_updated_at
BEFORE UPDATE ON approval_conditions
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
