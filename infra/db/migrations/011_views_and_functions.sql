-- 011_views_and_functions.sql
-- Business calendar duration calculation, clock elapsed view, timeline view, and materialized views

-- 1. Business seconds calculation function
CREATE OR REPLACE FUNCTION fn_business_seconds(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS BIGINT AS $$
DECLARE
    cur_date DATE;
    end_date DATE;
    tot_seconds BIGINT := 0;
    is_work BOOLEAN;
    day_start TIMESTAMPTZ;
    day_end TIMESTAMPTZ;
    seg_start TIMESTAMPTZ;
    seg_end TIMESTAMPTZ;
BEGIN
    IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
        RETURN 0;
    END IF;

    cur_date := (p_start AT TIME ZONE 'UTC')::DATE;
    end_date := (p_end AT TIME ZONE 'UTC')::DATE;

    WHILE cur_date <= end_date LOOP
        -- Check business calendar, default Mon-Fri (1-5) as working
        SELECT is_working INTO is_work
        FROM business_calendar
        WHERE date = cur_date;

        IF is_work IS NULL THEN
            is_work := (EXTRACT(ISODOW FROM cur_date) < 6);
        END IF;

        IF is_work THEN
            -- Working window: 09:30 to 17:30 (8 hours = 28,800 seconds)
            day_start := (cur_date || ' 09:30:00+00')::TIMESTAMPTZ;
            day_end   := (cur_date || ' 17:30:00+00')::TIMESTAMPTZ;

            seg_start := GREATEST(p_start, day_start);
            seg_end   := LEAST(p_end, day_end);

            IF seg_end > seg_start THEN
                tot_seconds := tot_seconds + EXTRACT(EPOCH FROM (seg_end - seg_start))::BIGINT;
            END IF;
        END IF;

        cur_date := cur_date + 1;
    END LOOP;

    RETURN tot_seconds;
END;
$$ LANGUAGE plpgsql STABLE;

-- 2. View: v_clock_elapsed
CREATE OR REPLACE VIEW v_clock_elapsed AS
SELECT
    application_id,
    clock,
    COUNT(*) AS event_count,
    COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(stopped_at, NOW()) - started_at)))::BIGINT, 0) AS total_seconds,
    COALESCE(SUM(fn_business_seconds(started_at, COALESCE(stopped_at, NOW()))), 0) AS business_seconds,
    BOOL_OR(stopped_at IS NULL) AS is_currently_running
FROM clock_events
GROUP BY application_id, clock;

-- 3. View: v_application_timeline
CREATE OR REPLACE VIEW v_application_timeline AS
SELECT
    a.id AS application_id,
    a.ref_no,
    a.track,
    a.state,
    al.seq AS audit_seq,
    al.ts AS event_time,
    al.action,
    al.actor_role,
    al.actor_id,
    al.entity_type,
    al.entity_id,
    al.old_state,
    al.new_state,
    al.payload,
    al.ai_assisted
FROM applications a
JOIN audit_log al ON al.application_id = a.id
ORDER BY a.id, al.seq ASC;

-- 4. Materialized View: mv_pendency_by_stage_region
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_pendency_by_stage_region AS
SELECT
    a.state AS stage,
    inst.region_id,
    r.code AS region_code,
    r.name AS region_name,
    COUNT(a.id) AS pending_count,
    AVG(EXTRACT(EPOCH FROM (NOW() - a.state_entered_at)) / 86400.0)::NUMERIC(6, 2) AS avg_days_in_stage,
    MAX(EXTRACT(EPOCH FROM (NOW() - a.state_entered_at)) / 86400.0)::NUMERIC(6, 2) AS max_days_in_stage
FROM applications a
JOIN institutions inst ON a.institution_id = inst.id
JOIN regions r ON inst.region_id = r.id
WHERE a.state NOT IN ('APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED')
GROUP BY a.state, inst.region_id, r.code, r.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_pendency_unique
ON mv_pendency_by_stage_region(stage, region_id);

-- 5. Materialized View: mv_ageing_buckets
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_ageing_buckets AS
SELECT
    a.id AS application_id,
    a.ref_no,
    a.state,
    a.track,
    a.institution_id,
    (EXTRACT(EPOCH FROM (NOW() - a.created_at)) / 86400.0)::INT AS total_age_days,
    CASE
        WHEN (NOW() - a.created_at) < INTERVAL '7 days' THEN '0-7 days'
        WHEN (NOW() - a.created_at) < INTERVAL '15 days' THEN '8-15 days'
        WHEN (NOW() - a.created_at) < INTERVAL '30 days' THEN '16-30 days'
        WHEN (NOW() - a.created_at) < INTERVAL '60 days' THEN '31-60 days'
        ELSE '60+ days'
    END AS ageing_bucket
FROM applications a
WHERE a.state NOT IN ('APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED');

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_ageing_unique
ON mv_ageing_buckets(application_id);

-- 6. Materialized View: mv_officer_workload
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_officer_workload AS
SELECT
    u.id AS officer_id,
    u.full_name AS officer_name,
    u.role AS officer_role,
    u.region_id,
    COUNT(t.id) FILTER (WHERE t.status = 'OPEN') AS open_tasks_count,
    COUNT(t.id) FILTER (WHERE t.status = 'OPEN' AND t.due_at < NOW()) AS overdue_tasks_count,
    COUNT(t.id) FILTER (WHERE t.status = 'DONE') AS completed_tasks_count
FROM users u
LEFT JOIN tasks t ON t.assignee_id = u.id
WHERE u.role IN ('SCRUTINY_OFFICER', 'REGIONAL_OFFICER', 'EVC_MEMBER', 'COMMITTEE_MEMBER')
GROUP BY u.id, u.full_name, u.role, u.region_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_officer_workload_unique
ON mv_officer_workload(officer_id);

-- 7. Materialized View: mv_bottlenecks
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_bottlenecks AS
SELECT
    a.state AS stage,
    COUNT(a.id) AS applications_stuck,
    AVG(EXTRACT(EPOCH FROM (NOW() - a.state_entered_at)) / 86400.0)::NUMERIC(6, 2) AS avg_duration_days,
    COUNT(d.id) FILTER (WHERE d.status = 'OPEN') AS open_deficiencies_count
FROM applications a
LEFT JOIN deficiencies d ON d.application_id = a.id
WHERE a.state NOT IN ('APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED')
GROUP BY a.state;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_bottlenecks_unique
ON mv_bottlenecks(stage);

-- 8. Materialized View: mv_compliance_risk
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_compliance_risk AS
SELECT
    inst.id AS institution_id,
    inst.name AS institution_name,
    inst.region_id,
    COUNT(ci.id) FILTER (WHERE ci.status = 'EXPIRED') AS expired_items_count,
    COUNT(ci.id) FILTER (WHERE ci.status = 'EXPIRING' OR (ci.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days')) AS expiring_soon_count,
    COUNT(ci.id) FILTER (WHERE ci.status = 'VALID') AS valid_items_count
FROM institutions inst
LEFT JOIN compliance_items ci ON ci.institution_id = inst.id
GROUP BY inst.id, inst.name, inst.region_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_compliance_risk_unique
ON mv_compliance_risk(institution_id);

-- 9. Materialized View: mv_deficiency_patterns
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_deficiency_patterns AS
SELECT
    d.clause_id,
    d.category,
    COUNT(d.id) AS total_occurrences,
    COUNT(d.id) FILTER (WHERE d.status = 'CLOSED') AS accepted_count,
    COUNT(d.id) FILTER (WHERE d.status = 'WAIVED') AS waived_count
FROM deficiencies d
WHERE d.clause_id IS NOT NULL
GROUP BY d.clause_id, d.category;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_deficiency_patterns_unique
ON mv_deficiency_patterns(clause_id, category);
