-- 004_workflow_config.sql
-- Workflow definitions, transitions, SLA policies, escalations, calendar, document types, APH clauses & rule engine

-- 1. Workflow Definitions
CREATE TABLE IF NOT EXISTS workflow_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track workflow_track_enum NOT NULL,
    version INT NOT NULL DEFAULT 1,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    definition JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (track, version)
);
CREATE TRIGGER trg_workflow_definitions_updated_at
BEFORE UPDATE ON workflow_definitions
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 2. Workflow Transitions (Strict guard table for state machine)
CREATE TABLE IF NOT EXISTS workflow_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    definition_id UUID NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
    from_state application_state_enum NOT NULL,
    to_state application_state_enum NOT NULL,
    action VARCHAR(100) NOT NULL,
    allowed_roles role_enum[] NOT NULL,
    guards JSONB NOT NULL DEFAULT '{}'::jsonb,
    requires_reason BOOLEAN NOT NULL DEFAULT FALSE,
    requires_clause BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (definition_id, from_state, action)
);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_lookup ON workflow_transitions(definition_id, from_state, to_state);

-- 3. SLA Policies
CREATE TABLE IF NOT EXISTS sla_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_state application_state_enum NOT NULL,
    application_type VARCHAR(100) NOT NULL DEFAULT 'ALL',
    owner_kind clock_owner_enum NOT NULL,
    duration_hours INT NOT NULL,
    reminder_pct INT NOT NULL DEFAULT 80,
    grace_hours INT NOT NULL DEFAULT 24,
    business_hours_only BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_sla_policies_updated_at
BEFORE UPDATE ON sla_policies
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 4. Escalation Rules
CREATE TABLE IF NOT EXISTS escalation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_kind clock_owner_enum NOT NULL,
    level INT NOT NULL,
    trigger_pct INT NOT NULL,
    extra_hours INT NOT NULL DEFAULT 0,
    notify_roles role_enum[] NOT NULL,
    channels TEXT[] NOT NULL DEFAULT ARRAY['IN_APP', 'EMAIL'],
    action VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Business Calendar
CREATE TABLE IF NOT EXISTS business_calendar (
    date DATE PRIMARY KEY,
    is_working BOOLEAN NOT NULL DEFAULT TRUE,
    note TEXT
);
CREATE INDEX IF NOT EXISTS idx_business_calendar_working ON business_calendar(is_working);

-- 6. Document Types
CREATE TABLE IF NOT EXISTS document_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    required_for JSONB NOT NULL DEFAULT '[]'::jsonb,
    has_expiry BOOLEAN NOT NULL DEFAULT FALSE,
    default_alert_days INT[] NOT NULL DEFAULT ARRAY[30, 15, 7, 0],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. APH Clauses (Vector Search & Full Text Search)
CREATE TABLE IF NOT EXISTS aph_clauses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    handbook_version VARCHAR(20) NOT NULL DEFAULT '2024-27',
    section_no VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    embedding VECTOR(1024),
    tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (handbook_version, section_no)
);

-- HNSW and GIN indexes
CREATE INDEX IF NOT EXISTS idx_aph_clauses_embedding ON aph_clauses USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_aph_clauses_tsv ON aph_clauses USING gin (tsv);

-- 8. Rule Definitions (APH Rule Engine)
CREATE TABLE IF NOT EXISTS rule_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clause_id UUID REFERENCES aph_clauses(id) ON DELETE SET NULL,
    key VARCHAR(100) NOT NULL UNIQUE,
    expression JSONB NOT NULL,
    severity VARCHAR(30) NOT NULL DEFAULT 'ERROR',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_rule_definitions_updated_at
BEFORE UPDATE ON rule_definitions
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
