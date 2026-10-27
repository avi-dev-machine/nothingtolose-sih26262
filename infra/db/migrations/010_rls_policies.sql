-- 010_rls_policies.sql
-- Row-Level Security (RLS) on applications, documents, deficiencies, compliance_items, notifications, tasks

-- 1. Create dedicated application role (non-superuser, non-owner)
DO $$ BEGIN
    CREATE ROLE aicte_app WITH LOGIN PASSWORD 'aicte_app_secret';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

GRANT USAGE ON SCHEMA public TO aicte_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aicte_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aicte_app;

-- Strictly REVOKE UPDATE, DELETE, TRUNCATE on audit_log from aicte_app (Rule 1)
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM aicte_app;

-- 2. Enable RLS on core operational tables
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE deficiencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- 3. Applications RLS Policy
CREATE POLICY p_applications_isolation ON applications
FOR ALL
USING (
    current_setting('app.role', true) IN ('ADMIN', 'BUREAU_OFFICER') OR
    (current_setting('app.role', true) = 'INSTITUTION' AND institution_id = NULLIF(current_setting('app.institution_id', true), '')::UUID) OR
    (current_setting('app.role', true) IN ('SCRUTINY_OFFICER', 'REGIONAL_OFFICER', 'EVC_MEMBER', 'COMMITTEE_MEMBER') AND
     institution_id IN (SELECT id FROM institutions WHERE region_id = NULLIF(current_setting('app.region_id', true), '')::UUID))
);

-- 4. Documents RLS Policy
CREATE POLICY p_documents_isolation ON documents
FOR ALL
USING (
    current_setting('app.role', true) IN ('ADMIN', 'BUREAU_OFFICER') OR
    (current_setting('app.role', true) = 'INSTITUTION' AND institution_id = NULLIF(current_setting('app.institution_id', true), '')::UUID) OR
    (current_setting('app.role', true) IN ('SCRUTINY_OFFICER', 'REGIONAL_OFFICER', 'EVC_MEMBER', 'COMMITTEE_MEMBER') AND
     institution_id IN (SELECT id FROM institutions WHERE region_id = NULLIF(current_setting('app.region_id', true), '')::UUID))
);

-- 5. Deficiencies RLS Policy
CREATE POLICY p_deficiencies_isolation ON deficiencies
FOR ALL
USING (
    current_setting('app.role', true) IN ('ADMIN', 'BUREAU_OFFICER') OR
    (application_id IN (
        SELECT id FROM applications
        WHERE (current_setting('app.role', true) = 'INSTITUTION' AND institution_id = NULLIF(current_setting('app.institution_id', true), '')::UUID) OR
              (current_setting('app.role', true) IN ('SCRUTINY_OFFICER', 'REGIONAL_OFFICER', 'EVC_MEMBER', 'COMMITTEE_MEMBER') AND
               institution_id IN (SELECT id FROM institutions WHERE region_id = NULLIF(current_setting('app.region_id', true), '')::UUID))
    ))
);

-- 6. Compliance Items RLS Policy
CREATE POLICY p_compliance_items_isolation ON compliance_items
FOR ALL
USING (
    current_setting('app.role', true) IN ('ADMIN', 'BUREAU_OFFICER') OR
    (current_setting('app.role', true) = 'INSTITUTION' AND institution_id = NULLIF(current_setting('app.institution_id', true), '')::UUID) OR
    (current_setting('app.role', true) IN ('SCRUTINY_OFFICER', 'REGIONAL_OFFICER', 'EVC_MEMBER', 'COMMITTEE_MEMBER') AND
     institution_id IN (SELECT id FROM institutions WHERE region_id = NULLIF(current_setting('app.region_id', true), '')::UUID))
);

-- 7. Notifications RLS Policy (strictly private to user, except admin)
CREATE POLICY p_notifications_isolation ON notifications
FOR ALL
USING (
    current_setting('app.role', true) = 'ADMIN' OR
    user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
);

-- 8. Tasks RLS Policy
CREATE POLICY p_tasks_isolation ON tasks
FOR ALL
USING (
    current_setting('app.role', true) IN ('ADMIN', 'BUREAU_OFFICER') OR
    assignee_id = NULLIF(current_setting('app.user_id', true), '')::UUID OR
    application_id IN (
        SELECT id FROM applications
        WHERE current_setting('app.role', true) IN ('REGIONAL_OFFICER') AND
              institution_id IN (SELECT id FROM institutions WHERE region_id = NULLIF(current_setting('app.region_id', true), '')::UUID)
    )
);
