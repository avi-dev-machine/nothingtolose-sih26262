-- 007_compliance_notifications_ai.down.sql
DROP TABLE IF EXISTS rag_queries CASCADE;
DROP TABLE IF EXISTS risk_scores CASCADE;
DROP TABLE IF EXISTS document_extractions CASCADE;
DROP TABLE IF EXISTS ai_suggestions CASCADE;
DROP TABLE IF EXISTS digests CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS notification_prefs CASCADE;
DROP TABLE IF EXISTS notification_templates CASCADE;
DROP TABLE IF EXISTS compliance_alerts CASCADE;
DROP TABLE IF EXISTS compliance_items CASCADE;
