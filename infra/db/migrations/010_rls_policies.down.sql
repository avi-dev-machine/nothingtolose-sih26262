-- 010_rls_policies.down.sql
DROP POLICY IF EXISTS p_tasks_isolation ON tasks;
DROP POLICY IF EXISTS p_notifications_isolation ON notifications;
DROP POLICY IF EXISTS p_compliance_items_isolation ON compliance_items;
DROP POLICY IF EXISTS p_deficiencies_isolation ON deficiencies;
DROP POLICY IF EXISTS p_documents_isolation ON documents;
DROP POLICY IF EXISTS p_applications_isolation ON applications;

ALTER TABLE tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE deficiencies DISABLE ROW LEVEL SECURITY;
ALTER TABLE documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE applications DISABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM aicte_app;
REVOKE USAGE ON SCHEMA public FROM aicte_app;
DROP ROLE IF EXISTS aicte_app;
