-- Backend control-plane configuration and security state.
-- This migration deliberately keeps workflow and SLA behaviour as data, not application constants.

CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    replaced_by_id UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address VARCHAR(45),
    user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active
    ON refresh_tokens(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS workflow_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track VARCHAR(20),
    from_state VARCHAR(50) NOT NULL,
    to_state VARCHAR(50) NOT NULL,
    allowed_roles JSONB NOT NULL,
    required_gates JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE NULLS NOT DISTINCT (track, from_state, to_state)
);

CREATE TABLE IF NOT EXISTS sla_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state VARCHAR(50) NOT NULL UNIQUE,
    sla_hours INTEGER NOT NULL CHECK (sla_hours > 0),
    near_breach_percent NUMERIC(5,2) NOT NULL DEFAULT 80 CHECK (near_breach_percent >= 0 AND near_breach_percent <= 100),
    escalation_after_hours INTEGER NOT NULL CHECK (escalation_after_hours >= 0),
    escalation_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(80) NOT NULL UNIQUE,
    channel VARCHAR(30) NOT NULL,
    subject_template VARCHAR(255) NOT NULL,
    body_template TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(30) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(user_id, channel)
);

-- Outbox events are committed with the workflow mutation. The worker dispatches them to BullMQ.
CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic VARCHAR(80) NOT NULL,
    aggregate_type VARCHAR(80) NOT NULL,
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(created_at) WHERE dispatched_at IS NULL;

CREATE TABLE IF NOT EXISTS task_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    assignee_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    task_type VARCHAR(50) NOT NULL,
    due_at TIMESTAMPTZ,
    status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_task_assignments_assignee ON task_assignments(assignee_id, status);

-- Workflow rules. They are editable through the admin API and read at every transition.
INSERT INTO workflow_rules (track, from_state, to_state, allowed_roles, required_gates) VALUES
  (NULL, 'DRAFT', 'SUBMITTED', '["INSTITUTION"]', '[]'),
  ('TRACK_A', 'SUBMITTED', 'UNDER_SCRUTINY', '["SCRUTINY_OFFICER","REGIONAL_OFFICER","BUREAU_OFFICER"]', '[]'),
  ('TRACK_B', 'SUBMITTED', 'UNDER_SCRUTINY', '["SCRUTINY_OFFICER","REGIONAL_OFFICER","BUREAU_OFFICER"]', '[]'),
  ('TRACK_C', 'SUBMITTED', 'UNDER_SCRUTINY', '["SCRUTINY_OFFICER","REGIONAL_OFFICER","BUREAU_OFFICER"]', '[]'),
  ('TRACK_D', 'SUBMITTED', 'EVC_REQUIRED', '["REGIONAL_OFFICER","BUREAU_OFFICER"]', '[]'),
  (NULL, 'UNDER_SCRUTINY', 'DEFICIENCY_RAISED', '["SCRUTINY_OFFICER","REGIONAL_OFFICER","BUREAU_OFFICER"]', '[]'),
  (NULL, 'DEFICIENCY_RAISED', 'RESUBMITTED', '["INSTITUTION"]', '["OPEN_DEFICIENCY"]'),
  (NULL, 'RESUBMITTED', 'UNDER_SCRUTINY', '["SCRUTINY_OFFICER","REGIONAL_OFFICER","BUREAU_OFFICER"]', '["RESPONDED_DEFICIENCY"]'),
  (NULL, 'RESUBMITTED', 'DEFICIENCY_RAISED', '["SCRUTINY_OFFICER","REGIONAL_OFFICER","BUREAU_OFFICER"]', '["RESPONDED_DEFICIENCY"]'),
  ('TRACK_A', 'UNDER_SCRUTINY', 'SCRUTINY_CLEARED', '["SCRUTINY_OFFICER","REGIONAL_OFFICER","BUREAU_OFFICER"]', '["NO_OPEN_DEFICIENCIES"]'),
  ('TRACK_B', 'UNDER_SCRUTINY', 'SCRUTINY_CLEARED', '["SCRUTINY_OFFICER","REGIONAL_OFFICER","BUREAU_OFFICER"]', '["NO_OPEN_DEFICIENCIES"]'),
  ('TRACK_C', 'UNDER_SCRUTINY', 'SCRUTINY_CLEARED', '["SCRUTINY_OFFICER","REGIONAL_OFFICER","BUREAU_OFFICER"]', '["NO_OPEN_DEFICIENCIES"]'),
  ('TRACK_A', 'SCRUTINY_CLEARED', 'FINAL_DECISION', '["BUREAU_OFFICER","COMMITTEE_MEMBER"]', '[]'),
  ('TRACK_B', 'SCRUTINY_CLEARED', 'EVC_REQUIRED', '["REGIONAL_OFFICER","BUREAU_OFFICER"]', '[]'),
  ('TRACK_C', 'SCRUTINY_CLEARED', 'EVC_REQUIRED', '["REGIONAL_OFFICER","BUREAU_OFFICER"]', '[]'),
  (NULL, 'EVC_REQUIRED', 'EVC_SCHEDULED', '["REGIONAL_OFFICER","BUREAU_OFFICER"]', '["EVC_VISIT_SCHEDULED"]'),
  (NULL, 'EVC_SCHEDULED', 'EVC_IN_PROGRESS', '["EVC_MEMBER","REGIONAL_OFFICER"]', '["EVC_VISIT_SCHEDULED"]'),
  (NULL, 'EVC_IN_PROGRESS', 'EVC_COMPLETED', '["EVC_MEMBER","REGIONAL_OFFICER"]', '["EVC_REPORT_COMPLETED"]'),
  (NULL, 'EVC_COMPLETED', 'COMMITTEE_REVIEW', '["BUREAU_OFFICER","COMMITTEE_MEMBER"]', '["EVC_REPORT_COMPLETED"]'),
  (NULL, 'COMMITTEE_REVIEW', 'FINAL_DECISION', '["BUREAU_OFFICER","COMMITTEE_MEMBER"]', '["COMMITTEE_DECISION_RECORDED"]'),
  (NULL, 'FINAL_DECISION', 'APPROVED', '["BUREAU_OFFICER","COMMITTEE_MEMBER"]', '["COMMITTEE_DECISION_RECORDED"]'),
  (NULL, 'FINAL_DECISION', 'APPROVED_WITH_CONDITIONS', '["BUREAU_OFFICER","COMMITTEE_MEMBER"]', '["COMMITTEE_DECISION_RECORDED"]'),
  (NULL, 'FINAL_DECISION', 'REJECTED', '["BUREAU_OFFICER","COMMITTEE_MEMBER"]', '["COMMITTEE_DECISION_RECORDED"]'),
  (NULL, 'FINAL_DECISION', 'COMPLIANCE_REQUIRED', '["BUREAU_OFFICER","COMMITTEE_MEMBER"]', '["COMMITTEE_DECISION_RECORDED"]')
ON CONFLICT (track, from_state, to_state) DO NOTHING;

INSERT INTO sla_configs (state, sla_hours, near_breach_percent, escalation_after_hours, escalation_roles) VALUES
  ('DRAFT', 720, 80, 960, '["INSTITUTION"]'),
  ('SUBMITTED', 24, 80, 36, '["REGIONAL_OFFICER"]'),
  ('UNDER_SCRUTINY', 336, 80, 408, '["REGIONAL_OFFICER","BUREAU_OFFICER"]'),
  ('DEFICIENCY_RAISED', 336, 80, 408, '["INSTITUTION"]'),
  ('RESUBMITTED', 168, 80, 216, '["SCRUTINY_OFFICER","REGIONAL_OFFICER"]'),
  ('SCRUTINY_CLEARED', 72, 80, 96, '["REGIONAL_OFFICER"]'),
  ('EVC_REQUIRED', 168, 80, 216, '["REGIONAL_OFFICER"]'),
  ('EVC_SCHEDULED', 336, 80, 408, '["REGIONAL_OFFICER"]'),
  ('EVC_IN_PROGRESS', 48, 80, 72, '["REGIONAL_OFFICER"]'),
  ('EVC_COMPLETED', 120, 80, 168, '["BUREAU_OFFICER"]'),
  ('COMMITTEE_REVIEW', 168, 80, 216, '["BUREAU_OFFICER"]'),
  ('FINAL_DECISION', 72, 80, 96, '["BUREAU_OFFICER"]'),
  ('APPROVED', 24, 80, 48, '[]'),
  ('APPROVED_WITH_CONDITIONS', 24, 80, 48, '[]'),
  ('REJECTED', 24, 80, 48, '[]'),
  ('COMPLIANCE_REQUIRED', 24, 80, 48, '[]')
ON CONFLICT (state) DO NOTHING;

INSERT INTO notification_templates (code, channel, subject_template, body_template) VALUES
  ('WORKFLOW_TRANSITION', 'IN_APP', 'Application {{applicationNumber}} moved to {{state}}', 'Application {{applicationNumber}} changed from {{fromState}} to {{state}}. Reason: {{reason}}'),
  ('SLA_ESCALATION', 'IN_APP', 'SLA escalation: {{applicationNumber}}', 'Application {{applicationNumber}} is {{slaStatus}} and needs attention.'),
  ('COMPLIANCE_EXPIRY', 'IN_APP', 'Compliance item {{title}} requires attention', '{{title}} expires on {{expiryDate}}.')
ON CONFLICT (code) DO NOTHING;
