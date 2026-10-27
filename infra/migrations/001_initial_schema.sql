-- 001_initial_schema.sql
-- Plain SQL Migration for AICTE Approval Control Tower (SIH26262)

-- Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. Regions
CREATE TABLE IF NOT EXISTS regions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    states JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Institutions
CREATE TABLE IF NOT EXISTS institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    region_id UUID NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
    address TEXT NOT NULL,
    state VARCHAR(100) NOT NULL,
    city VARCHAR(100) NOT NULL,
    pincode VARCHAR(10) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(20) NOT NULL,
    institution_type VARCHAR(50) NOT NULL DEFAULT 'TECHNICAL',
    established_year INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
    region_id UUID REFERENCES regions(id) ON DELETE SET NULL,
    phone VARCHAR(20),
    totp_secret VARCHAR(255),
    is_totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    first_login_must_change_pwd BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 4. Applications
CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_number VARCHAR(64) NOT NULL UNIQUE,
    academic_year VARCHAR(10) NOT NULL,
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
    region_id UUID NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
    track VARCHAR(20) NOT NULL, -- TRACK_A, TRACK_B, TRACK_C, TRACK_D
    state VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    programme VARCHAR(100) NOT NULL,
    courses_data JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    assigned_scrutiny_officer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_applications_state ON applications(state);
CREATE INDEX IF NOT EXISTS idx_applications_institution ON applications(institution_id);
CREATE INDEX IF NOT EXISTS idx_applications_region ON applications(region_id);

-- 5. Clock Events (Derived dual clocks)
CREATE TABLE IF NOT EXISTS clock_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    active_clock VARCHAR(20) NOT NULL, -- INSTITUTION or AICTE
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trigger_source VARCHAR(50) NOT NULL, -- SYSTEM, OFFICER, INSTITUTION, CRON
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clock_events_app_time ON clock_events(application_id, timestamp ASC);

-- 6. Audit Ledger (Hash-chained, strictly append-only)
CREATE TABLE IF NOT EXISTS audit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_number BIGSERIAL NOT NULL UNIQUE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_id UUID NOT NULL,
    actor_role VARCHAR(50) NOT NULL,
    actor_email VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_entity VARCHAR(50) NOT NULL,
    target_id UUID NOT NULL,
    previous_hash VARCHAR(64) NOT NULL,
    current_hash VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_seq ON audit_ledger(sequence_number ASC);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_target ON audit_ledger(target_entity, target_id);

-- Enforce Append-Only on Audit Ledger via PostgreSQL Trigger
CREATE OR REPLACE FUNCTION prevent_audit_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit ledger is strictly append-only. UPDATE or DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_audit_ledger_immutable
BEFORE UPDATE OR DELETE ON audit_ledger
FOR EACH ROW EXECUTE FUNCTION prevent_audit_ledger_mutation();

-- 7. Deficiencies
CREATE TABLE IF NOT EXISTS deficiencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    clause_id VARCHAR(50) NOT NULL,
    clause_title VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    required_documents JSONB NOT NULL DEFAULT '[]'::jsonb,
    deadline_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'OPEN', -- OPEN, RESPONDED, RESOLVED, REJECTED
    response_note TEXT,
    response_documents JSONB NOT NULL DEFAULT '[]'::jsonb,
    responded_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    resolution_remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deficiencies_app ON deficiencies(application_id);

-- 8. EVC Visits
CREATE TABLE IF NOT EXISTS evc_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    scheduled_date TIMESTAMPTZ NOT NULL,
    lead_member_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    members JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED
    geo_latitude NUMERIC(10, 7),
    geo_longitude NUMERIC(10, 7),
    geo_accuracy_meters NUMERIC(8, 2),
    checklist_results JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommendation VARCHAR(50),
    justification TEXT,
    photo_document_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    report_submitted_at TIMESTAMPTZ,
    special_instructions TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_evc_visits_app ON evc_visits(application_id);

-- 9. Committee Decisions
CREATE TABLE IF NOT EXISTS committee_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    meeting_date DATE NOT NULL,
    committee_type VARCHAR(50) NOT NULL, -- SAC, SHC, EXECUTIVE_COMMITTEE
    decision VARCHAR(50) NOT NULL, -- APPROVED, APPROVED_WITH_CONDITIONS, REJECTED, COMPLIANCE_REQUIRED
    conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
    justification TEXT NOT NULL,
    recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_committee_decisions_app ON committee_decisions(application_id);

-- 10. Compliance Records (Radar & Expiry)
CREATE TABLE IF NOT EXISTS compliance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    issuing_authority VARCHAR(255) NOT NULL,
    reference_number VARCHAR(100) NOT NULL,
    issued_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    document_id UUID,
    alert_before_days INT NOT NULL DEFAULT 30,
    status VARCHAR(30) NOT NULL DEFAULT 'VALID', -- VALID, EXPIRING_SOON, EXPIRED, UNDER_RENEWAL, WAIVED
    renewal_document_id UUID,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_expiry ON compliance_records(expiry_date ASC);
CREATE INDEX IF NOT EXISTS idx_compliance_inst ON compliance_records(institution_id);

-- 11. Documents
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
    application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    s3_bucket VARCHAR(100) NOT NULL,
    s3_key VARCHAR(500) NOT NULL,
    sha256_checksum VARCHAR(64) NOT NULL,
    classification VARCHAR(100),
    extracted_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ocr_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_app ON documents(application_id);
CREATE INDEX IF NOT EXISTS idx_documents_checksum ON documents(sha256_checksum);

-- 12. APH Clauses (Hand-book clauses with Vector Embeddings for RAG)
CREATE TABLE IF NOT EXISTS aph_clauses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clause_number VARCHAR(50) NOT NULL UNIQUE,
    chapter VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
    embedding VECTOR(1024), -- sentence-transformers bge-m3 dimension
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. AI Suggestions (Audit & Override logging)
CREATE TABLE IF NOT EXISTS ai_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    suggestion_type VARCHAR(50) NOT NULL,
    model_name VARCHAR(100) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    confidence_score NUMERIC(5, 4) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_overridden BOOLEAN NOT NULL DEFAULT FALSE,
    overridden_by UUID REFERENCES users(id) ON DELETE SET NULL,
    override_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_app ON ai_suggestions(application_id);

-- 14. Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
    recipient_role VARCHAR(50),
    channel VARCHAR(30) NOT NULL DEFAULT 'IN_APP', -- IN_APP, EMAIL, SMS
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- PENDING, SENT, FAILED
    read BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, read);
