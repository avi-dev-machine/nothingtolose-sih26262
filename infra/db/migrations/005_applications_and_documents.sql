-- 005_applications_and_documents.sql
-- Applications, forms, documents, deficiencies, tasks, document immutability, and separation of duties

-- 1. Applications (Optimistic Locking via version)
CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref_no VARCHAR(64) NOT NULL UNIQUE,
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
    type VARCHAR(100) NOT NULL DEFAULT 'EXTENSION_OF_APPROVAL',
    track workflow_track_enum NOT NULL,
    state application_state_enum NOT NULL DEFAULT 'DRAFT',
    state_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    current_owner_role role_enum NOT NULL DEFAULT 'INSTITUTION',
    due_at TIMESTAMPTZ,
    priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    risk_score NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    risk_level VARCHAR(20) NOT NULL DEFAULT 'LOW',
    submitted_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_applications_updated_at
BEFORE UPDATE ON applications
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 2. Application Forms
CREATE TABLE IF NOT EXISTS application_forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    version INT NOT NULL DEFAULT 1,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    valid BOOLEAN NOT NULL DEFAULT FALSE,
    validation_report JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (application_id, version)
);

-- 3. Documents (Immutable payload, status and verified_by only mutable)
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
    document_type_id UUID NOT NULL REFERENCES document_types(id) ON DELETE RESTRICT,
    storage_key VARCHAR(500) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime VARCHAR(100) NOT NULL,
    size BIGINT NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    supersedes_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    status document_status_enum NOT NULL DEFAULT 'UPLOADED',
    uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (application_id, document_type_id, version)
);
CREATE TRIGGER trg_documents_updated_at
BEFORE UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Document Immutability Trigger: only status and verified_by can change
CREATE OR REPLACE FUNCTION fn_enforce_document_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.id != NEW.id OR
        OLD.application_id IS DISTINCT FROM NEW.application_id OR
        OLD.institution_id != NEW.institution_id OR
        OLD.document_type_id != NEW.document_type_id OR
        OLD.storage_key != NEW.storage_key OR
        OLD.original_name != NEW.original_name OR
        OLD.mime != NEW.mime OR
        OLD.size != NEW.size OR
        OLD.sha256 != NEW.sha256 OR
        OLD.version != NEW.version OR
        OLD.uploaded_by != NEW.uploaded_by) THEN
        RAISE EXCEPTION 'Document metadata and payload are immutable. Only status and verified_by may be updated.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_immutable
BEFORE UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION fn_enforce_document_immutability();

-- 4. Deficiencies
CREATE TABLE IF NOT EXISTS deficiencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    clause_id UUID REFERENCES aph_clauses(id) ON DELETE SET NULL,
    category VARCHAR(50) NOT NULL,
    remarks TEXT NOT NULL,
    required_document_type_id UUID REFERENCES document_types(id) ON DELETE SET NULL,
    due_at TIMESTAMPTZ NOT NULL,
    status deficiency_status_enum NOT NULL DEFAULT 'OPEN',
    raised_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    raised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_deficiencies_updated_at
BEFORE UPDATE ON deficiencies
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 5. Deficiency Responses
CREATE TABLE IF NOT EXISTS deficiency_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deficiency_id UUID NOT NULL REFERENCES deficiencies(id) ON DELETE CASCADE,
    response_text TEXT NOT NULL,
    document_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    responded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Tasks
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    kind VARCHAR(100) NOT NULL,
    assignee_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assignee_role role_enum NOT NULL,
    state_ref application_state_enum NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    status task_status_enum NOT NULL DEFAULT 'OPEN',
    sla_policy_id UUID REFERENCES sla_policies(id) ON DELETE SET NULL,
    reminded_pct INT[] NOT NULL DEFAULT ARRAY[]::INT[],
    escalation_level INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 7. Reassignments
CREATE TABLE IF NOT EXISTS reassignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    from_user UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    to_user UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL,
    by_user UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
