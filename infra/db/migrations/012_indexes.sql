-- 012_indexes.sql
-- Comprehensive indexing: Every Foreign Key, Composite hot-query indexes, Partial indexes, and Trigram search

-- 1. Foreign Key Indexes
CREATE INDEX IF NOT EXISTS idx_institutions_region ON institutions(region_id);
CREATE INDEX IF NOT EXISTS idx_users_institution ON users(institution_id);
CREATE INDEX IF NOT EXISTS idx_users_region ON users(region_id);
CREATE INDEX IF NOT EXISTS idx_applications_institution ON applications(institution_id);
CREATE INDEX IF NOT EXISTS idx_applications_owner ON applications(current_owner_id);
CREATE INDEX IF NOT EXISTS idx_application_forms_app ON application_forms(application_id);
CREATE INDEX IF NOT EXISTS idx_documents_app ON documents(application_id);
CREATE INDEX IF NOT EXISTS idx_documents_inst ON documents(institution_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(document_type_id);
CREATE INDEX IF NOT EXISTS idx_documents_supersedes ON documents(supersedes_id);
CREATE INDEX IF NOT EXISTS idx_deficiencies_app ON deficiencies(application_id);
CREATE INDEX IF NOT EXISTS idx_deficiencies_clause ON deficiencies(clause_id);
CREATE INDEX IF NOT EXISTS idx_deficiencies_doc_type ON deficiencies(required_document_type_id);
CREATE INDEX IF NOT EXISTS idx_deficiency_responses_def ON deficiency_responses(deficiency_id);
CREATE INDEX IF NOT EXISTS idx_tasks_app ON tasks(application_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_sla ON tasks(sla_policy_id);
CREATE INDEX IF NOT EXISTS idx_reassignments_task ON reassignments(task_id);
CREATE INDEX IF NOT EXISTS idx_clock_events_app ON clock_events(application_id);
CREATE INDEX IF NOT EXISTS idx_evc_visits_app ON evc_visits(application_id);
CREATE INDEX IF NOT EXISTS idx_evc_findings_visit ON evc_findings(visit_id);
CREATE INDEX IF NOT EXISTS idx_compliance_items_inst ON compliance_items(institution_id);
CREATE INDEX IF NOT EXISTS idx_compliance_items_app ON compliance_items(application_id);
CREATE INDEX IF NOT EXISTS idx_compliance_items_doc ON compliance_items(document_id);
CREATE INDEX IF NOT EXISTS idx_compliance_items_type ON compliance_items(document_type_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_entity ON ai_suggestions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_document_extractions_doc ON document_extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_risk_scores_app ON risk_scores(application_id);
CREATE INDEX IF NOT EXISTS idx_rag_queries_user ON rag_queries(user_id);

-- 2. Composite Hot-Query Indexes
CREATE INDEX IF NOT EXISTS idx_applications_inst_state_due ON applications(institution_id, state, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status_due ON tasks(assignee_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_compliance_expiry_status ON compliance_items(expiry_date, status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_status_created ON notifications(user_id, status, created_at);

-- 3. Partial Indexes for High Cardinality / Frequent Worklists
CREATE INDEX IF NOT EXISTS idx_tasks_open_due ON tasks(due_at) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_applications_active ON applications(state, state_entered_at)
WHERE state NOT IN ('APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED');
CREATE INDEX IF NOT EXISTS idx_compliance_radar_expiring ON compliance_items(expiry_date)
WHERE status IN ('VALID', 'EXPIRING');

-- 4. Trigram Indexes for Fast Substring and Fuzzy Search
CREATE INDEX IF NOT EXISTS idx_institutions_name_trgm ON institutions USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_applications_ref_no_trgm ON applications USING gin (ref_no gin_trgm_ops);
