-- 007_compliance_notifications_ai.sql
-- Compliance registry & radar, idempotent alerts, notifications with dedupe keys, digests, and AI suggestions/extractions

-- 1. Compliance Items
CREATE TABLE IF NOT EXISTS compliance_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    document_type_id UUID NOT NULL REFERENCES document_types(id) ON DELETE RESTRICT,
    issue_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    status compliance_status_enum NOT NULL DEFAULT 'VALID',
    verification_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    source compliance_source_enum NOT NULL DEFAULT 'MANUAL',
    extraction_confidence NUMERIC(5, 4),
    next_alert_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_compliance_items_updated_at
BEFORE UPDATE ON compliance_items
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 2. Compliance Alerts (Idempotent: UNIQUE on item_id, threshold_days)
CREATE TABLE IF NOT EXISTS compliance_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES compliance_items(id) ON DELETE CASCADE,
    threshold_days INT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notification_id UUID,
    UNIQUE (item_id, threshold_days)
);

-- 3. Notification Templates
CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) NOT NULL,
    locale VARCHAR(10) NOT NULL DEFAULT 'en',
    subject TEXT NOT NULL,
    body_md TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (key, locale)
);

-- 4. Notification Preferences
CREATE TABLE IF NOT EXISTS notification_prefs (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL,
    event_key VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (user_id, channel, event_key)
);

-- 5. Notifications (Idempotent: dedupe_key UNIQUE)
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL DEFAULT 'IN_APP',
    template_key VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key VARCHAR(255) NOT NULL UNIQUE,
    status notification_status_enum NOT NULL DEFAULT 'PENDING',
    attempts INT NOT NULL DEFAULT 0,
    sent_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Daily Digests
CREATE TABLE IF NOT EXISTS digests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. AI Suggestions (Audit & override tracking)
CREATE TABLE IF NOT EXISTS ai_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    output JSONB NOT NULL,
    confidence NUMERIC(5, 4) NOT NULL,
    model VARCHAR(100) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    status ai_suggestion_status_enum NOT NULL DEFAULT 'PENDING',
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Document Extractions (OCR / Metadata / Expiry extraction)
CREATE TABLE IF NOT EXISTS document_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ocr_text TEXT,
    doc_type_pred VARCHAR(100),
    doc_type_conf NUMERIC(5, 4),
    dates JSONB NOT NULL DEFAULT '[]'::jsonb,
    needs_manual_review BOOLEAN NOT NULL DEFAULT FALSE,
    engine VARCHAR(50) NOT NULL DEFAULT 'paddleocr',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Risk Scores
CREATE TABLE IF NOT EXISTS risk_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    score NUMERIC(5, 2) NOT NULL,
    level VARCHAR(20) NOT NULL,
    factors JSONB NOT NULL DEFAULT '[]'::jsonb,
    model_version VARCHAR(50) NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. RAG Queries (Audit trail for citations and AI responses)
CREATE TABLE IF NOT EXISTS rag_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    citations JSONB NOT NULL DEFAULT '[]'::jsonb,
    retrieval_score NUMERIC(5, 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
