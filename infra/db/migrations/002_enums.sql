-- 002_enums.sql
-- Enums for roles, states, tracks, clocks and operational entities

DO $$ BEGIN
    CREATE TYPE role_enum AS ENUM (
        'INSTITUTION',
        'SCRUTINY_OFFICER',
        'REGIONAL_OFFICER',
        'EVC_MEMBER',
        'COMMITTEE_MEMBER',
        'BUREAU_OFFICER',
        'ADMIN'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE application_state_enum AS ENUM (
        'DRAFT',
        'SUBMITTED',
        'UNDER_SCRUTINY',
        'DEFICIENCY_RAISED',
        'RESUBMITTED',
        'SCRUTINY_CLEARED',
        'EVC_REQUIRED',
        'EVC_SCHEDULED',
        'EVC_IN_PROGRESS',
        'EVC_COMPLETED',
        'COMMITTEE_REVIEW',
        'FINAL_DECISION',
        'APPROVED',
        'APPROVED_WITH_CONDITIONS',
        'REJECTED',
        'COMPLIANCE_REQUIRED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE workflow_track_enum AS ENUM ('A', 'B', 'C', 'D');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE clock_owner_enum AS ENUM ('AICTE', 'INSTITUTION');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE document_status_enum AS ENUM (
        'UPLOADED',
        'SCANNED_CLEAN',
        'QUARANTINED',
        'VERIFIED',
        'REJECTED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE deficiency_status_enum AS ENUM (
        'OPEN',
        'RESPONDED',
        'CLOSED',
        'WAIVED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE task_status_enum AS ENUM (
        'OPEN',
        'DONE',
        'OVERDUE',
        'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE evc_visit_status_enum AS ENUM (
        'SCHEDULED',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE compliance_status_enum AS ENUM (
        'VALID',
        'EXPIRING',
        'EXPIRED',
        'RENEWED',
        'WAIVED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE compliance_source_enum AS ENUM ('MANUAL', 'AI_EXTRACTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_status_enum AS ENUM (
        'PENDING',
        'SENT',
        'FAILED',
        'READ'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE ai_suggestion_status_enum AS ENUM (
        'PENDING',
        'ACCEPTED',
        'EDITED',
        'REJECTED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
