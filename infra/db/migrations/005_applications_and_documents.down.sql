-- 005_applications_and_documents.down.sql
DROP TABLE IF EXISTS reassignments CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS deficiency_responses CASCADE;
DROP TABLE IF EXISTS deficiencies CASCADE;
DROP TRIGGER IF EXISTS trg_documents_immutable ON documents;
DROP FUNCTION IF EXISTS fn_enforce_document_immutability CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS application_forms CASCADE;
DROP TABLE IF EXISTS applications CASCADE;
