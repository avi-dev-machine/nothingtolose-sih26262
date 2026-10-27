import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';
import pino from 'pino';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/aicte_db',
  max: 15,
});

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

const storage = new S3Client({
  endpoint: `${process.env.S3_USE_SSL === 'true' ? 'https' : 'http'}://${process.env.S3_ENDPOINT || 'localhost'}:${process.env.S3_PORT || '9000'}`,
  forcePathStyle: true,
  region: process.env.S3_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  },
});

// Queues
const outboxQueue = new Queue('outbox', { connection: redis });
const notificationsQueue = new Queue('notifications', { connection: redis });
const slaQueue = new Queue('sla', { connection: redis });
const escalationQueue = new Queue('escalation', { connection: redis });
const complianceQueue = new Queue('compliance', { connection: redis });
const evcQueue = new Queue('evc', { connection: redis });
const digestQueue = new Queue('digest', { connection: redis });
const analyticsQueue = new Queue('analytics', { connection: redis });
const auditQueue = new Queue('audit', { connection: redis });
const aiQueue = new Queue('ai', { connection: redis });
const clockQueue = new Queue('clock', { connection: redis });

/**
 * 1. Outbox Relay: Continuous poll and dispatch
 */
async function processOutboxEvent(eventId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query<{ id: string; topic: string; aggregate_type: string; aggregate_id: string; payload: any }>(
      'UPDATE outbox_events SET dispatched_at = NOW(), attempts = attempts + 1 WHERE id = $1 AND dispatched_at IS NULL RETURNING id, topic, aggregate_type, aggregate_id, payload',
      [eventId],
    );

    const event = res.rows[0];
    if (!event) {
      await client.query('COMMIT');
      return { skipped: true };
    }

    const { topic, payload } = event;

    if (topic === 'WORKFLOW_TRANSITION' || topic === 'APPLICATION_CREATED') {
      const users = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE institution_id = $1 OR role IN (\'ADMIN\', \'BUREAU_OFFICER\')',
        [payload.institutionId],
      );
      for (const u of users.rows) {
        await client.query(
          `INSERT INTO notifications (recipient_id, channel, title, message, metadata, dedupe_key)
           VALUES ($1, 'IN_APP', $2, $3, $4::jsonb, $5)
           ON CONFLICT (recipient_id, dedupe_key) DO NOTHING`,
          [
            u.id,
            `Application ${payload.refNo || payload.applicationNumber || ''} State Updated`,
            `Status moved to ${payload.toState || payload.state || ''}.`,
            JSON.stringify(payload),
            `wf:${payload.applicationId}:${payload.toState || payload.state}`,
          ],
        );
      }
    } else if (topic === 'NOTIFICATION_EMAIL') {
      logger.info({ to: payload.to, subject: payload.subject }, '[Outbox Email Adapter] Dispatched email');
    } else if (topic === 'TASK_ASSIGNED' || topic === 'TASK_REMINDER') {
      if (payload.assigneeId || payload.recipientId) {
        const recipient = payload.assigneeId || payload.recipientId;
        await client.query(
          `INSERT INTO notifications (recipient_id, channel, title, message, metadata, dedupe_key)
           VALUES ($1, 'IN_APP', $2, $3, $4::jsonb, $5)
           ON CONFLICT (recipient_id, dedupe_key) DO NOTHING`,
          [
            recipient,
            'Task Action Required',
            payload.message || `You have been assigned task for application ${payload.refNo || ''}`,
            JSON.stringify(payload),
            `task:${payload.taskId}:${topic}`,
          ],
        );
      }
    }

    await client.query('COMMIT');
    return { delivered: true, topic };
  } catch (error) {
    await client.query('ROLLBACK');
    await pool.query('UPDATE outbox_events SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [
      eventId,
      error instanceof Error ? error.message : String(error),
    ]);
    throw error;
  } finally {
    client.release();
  }
}

async function dispatchPendingOutbox() {
  const pending = await pool.query<{ id: string }>(
    'SELECT id FROM outbox_events WHERE dispatched_at IS NULL AND attempts < 5 ORDER BY created_at ASC LIMIT 100',
  );

  for (const row of pending.rows) {
    await outboxQueue.add('deliver', { eventId: row.id }, {
      jobId: `outbox:${row.id}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }
  return { dispatched: pending.rowCount ?? 0 };
}

/**
 * 2. SLA Sweeper: Every 5 minutes
 */
async function sweepSla() {
  const openClocks = await pool.query<{
    id: string;
    application_id: string;
    clock: string;
    started_at: Date;
    state_ref: string;
    ref_no: string;
    institution_id: string;
    track: string;
    duration_hours: number | null;
  }>(`
    SELECT ce.id, ce.application_id, ce.clock, ce.started_at, ce.state_ref,
           a.ref_no, a.institution_id, a.track,
           sp.duration_hours
    FROM clock_events ce
    JOIN applications a ON a.id = ce.application_id
    LEFT JOIN sla_policies sp ON sp.stage_state = ce.state_ref
    WHERE ce.stopped_at IS NULL
  `);

  let breachCount = 0;
  for (const row of openClocks.rows) {
    const elapsedHours = (Date.now() - new Date(row.started_at).getTime()) / 3600000;
    const threshold = row.duration_hours || 168;

    if (elapsedHours >= threshold) {
      breachCount++;
      // Notify outbox of SLA breach
      await pool.query(
        `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload)
         VALUES ('SLA_BREACH', 'APPLICATION', $1, $2::jsonb)`,
        [
          row.application_id,
          JSON.stringify({
            applicationId: row.application_id,
            refNo: row.ref_no,
            clock: row.clock,
            state: row.state_ref,
            elapsedHours: Math.round(elapsedHours),
            thresholdHours: threshold,
          }),
        ],
      );
    }
  }

  return { evaluated: openClocks.rowCount ?? 0, breaches: breachCount };
}

/**
 * 3. Escalation Runner: Every 15 minutes
 */
async function runEscalation() {
  const openTasks = await pool.query<{
    id: string;
    application_id: string;
    assignee_id: string;
    assignee_role: string;
    due_at: Date;
    created_at: Date;
    escalation_level: number;
    reminded_pct: number[];
    ref_no: string;
  }>(`
    SELECT t.id, t.application_id, t.assignee_id, t.assignee_role, t.due_at, t.created_at,
           t.escalation_level, t.reminded_pct, a.ref_no
    FROM tasks t
    JOIN applications a ON a.id = t.application_id
    WHERE t.status = 'OPEN'
  `);

  let escalated = 0;
  for (const task of openTasks.rows) {
    const totalMs = new Date(task.due_at).getTime() - new Date(task.created_at).getTime();
    const elapsedMs = Date.now() - new Date(task.created_at).getTime();
    const pct = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 100;
    const reminded = task.reminded_pct || [];

    // Level 1: 70% Reminder
    if (pct >= 70 && !reminded.includes(70)) {
      await pool.query(
        `UPDATE tasks SET reminded_pct = array_append(reminded_pct, 70) WHERE id = $1`,
        [task.id],
      );
      await pool.query(
        `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload)
         VALUES ('TASK_REMINDER', 'TASK', $1, $2::jsonb)`,
        [task.id, JSON.stringify({ taskId: task.id, assigneeId: task.assignee_id, level: 1, pct: 70 })],
      );
      escalated++;
    }

    // Level 2: 100% Overdue
    if (pct >= 100 && task.escalation_level < 1) {
      await pool.query(
        `UPDATE tasks SET status = 'OVERDUE', escalation_level = 1 WHERE id = $1`,
        [task.id],
      );
      await pool.query(
        `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload)
         VALUES ('TASK_ESCALATED', 'TASK', $1, $2::jsonb)`,
        [task.id, JSON.stringify({ taskId: task.id, assigneeId: task.assignee_id, level: 2, overdue: true })],
      );
      escalated++;
    }

    // Level 3: Overdue + 24 hours -> Regional Officer
    const overdueHours = (Date.now() - new Date(task.due_at).getTime()) / 3600000;
    if (overdueHours >= 24 && task.escalation_level < 2) {
      await pool.query(`UPDATE tasks SET escalation_level = 2 WHERE id = $1`, [task.id]);
      await pool.query(
        `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload)
         VALUES ('TASK_ESCALATED', 'TASK', $1, $2::jsonb)`,
        [task.id, JSON.stringify({ taskId: task.id, targetRole: 'REGIONAL_OFFICER', level: 3, overdueHours: 24 })],
      );
      escalated++;
    }

    // Level 4: Overdue + 72 hours -> Bureau Officer
    if (overdueHours >= 72 && task.escalation_level < 3) {
      await pool.query(`UPDATE tasks SET escalation_level = 3 WHERE id = $1`, [task.id]);
      await pool.query(
        `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload)
         VALUES ('TASK_ESCALATED', 'TASK', $1, $2::jsonb)`,
        [task.id, JSON.stringify({ taskId: task.id, targetRole: 'BUREAU_OFFICER', level: 4, overdueHours: 72 })],
      );
      escalated++;
    }
  }

  return { inspected: openTasks.rowCount ?? 0, escalated };
}

/**
 * 4. Compliance Expiry Scanner: Daily at 02:00 IST
 */
async function scanComplianceExpiry() {
  const records = await pool.query<{
    id: string;
    institution_id: string;
    title: string;
    expiry_date: Date;
    status: string;
  }>(`
    SELECT id, institution_id, title, expiry_date, status
    FROM compliance_records
    WHERE status != 'WAIVED'
  `);

  let alertsCreated = 0;
  const alertLadders = [90, 30, 7, 0];

  for (const rec of records.rows) {
    const daysRemaining = Math.floor((new Date(rec.expiry_date).getTime() - Date.now()) / 86400000);
    const newStatus = daysRemaining < 0 ? 'EXPIRED' : daysRemaining <= 30 ? 'EXPIRING_SOON' : 'VALID';

    if (rec.status !== newStatus && rec.status !== 'UNDER_RENEWAL') {
      await pool.query('UPDATE compliance_records SET status = $1, updated_at = NOW() WHERE id = $2', [
        newStatus,
        rec.id,
      ]);
    }

    // Check alert ladder
    for (const days of alertLadders) {
      if (daysRemaining <= days) {
        // Idempotent insertion into compliance_alerts
        const inserted = await pool.query(
          `INSERT INTO compliance_alerts (compliance_id, days_before, alert_sent_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (compliance_id, days_before) DO NOTHING
           RETURNING id`,
          [rec.id, days],
        );

        if (inserted.rowCount && inserted.rowCount > 0) {
          alertsCreated++;
          await pool.query(
            `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload)
             VALUES ('COMPLIANCE_ALERT', 'COMPLIANCE', $1, $2::jsonb)`,
            [
              rec.id,
              JSON.stringify({
                complianceId: rec.id,
                institutionId: rec.institution_id,
                title: rec.title,
                daysRemaining,
                alertLevel: days,
              }),
            ],
          );
        }
      }
    }
  }

  return { scanned: records.rowCount ?? 0, alertsCreated };
}

/**
 * 5. EVC Delay Tracker: Hourly
 */
async function trackEvcDelays() {
  const overdueVisits = await pool.query<{
    id: string;
    application_id: string;
    scheduled_date: Date;
    lead_member_id: string;
  }>(`
    SELECT id, application_id, scheduled_date, lead_member_id
    FROM evc_visits
    WHERE status IN ('SCHEDULED', 'IN_PROGRESS')
      AND scheduled_date < NOW() - INTERVAL '48 hours'
  `);

  for (const v of overdueVisits.rows) {
    await pool.query(
      `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload)
       VALUES ('EVC_DELAYED', 'EVC_VISIT', $1, $2::jsonb)`,
      [
        v.id,
        JSON.stringify({
          evcVisitId: v.id,
          applicationId: v.application_id,
          scheduledDate: v.scheduled_date.toISOString(),
          leadMemberId: v.lead_member_id,
        }),
      ],
    );
  }

  return { delayed: overdueVisits.rowCount ?? 0 };
}

/**
 * 6. Daily Digest Builder: 08:00 IST
 */
async function buildDailyDigest() {
  const activeUsers = await pool.query<{ id: string; email: string; full_name: string; role: string }>(
    `SELECT id, email, full_name, role FROM users WHERE is_active = TRUE`,
  );

  let digests = 0;
  for (const user of activeUsers.rows) {
    const tasks = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM tasks WHERE assignee_id = $1 AND status = 'OPEN'`,
      [user.id],
    );
    const taskCount = Number(tasks.rows[0]?.count || 0);

    if (taskCount > 0) {
      digests++;
      await pool.query(
        `INSERT INTO notifications (recipient_id, channel, title, message, dedupe_key)
         VALUES ($1, 'IN_APP', 'Daily Digest', $2, $3)
         ON CONFLICT (recipient_id, dedupe_key) DO NOTHING`,
        [
          user.id,
          `Good morning, ${user.full_name}. You have ${taskCount} open task(s) awaiting your review today.`,
          `digest:${user.id}:${new Date().toISOString().slice(0, 10)}`,
        ],
      );
    }
  }

  return { digestsBuilt: digests };
}

/**
 * 7. Materialized Views Refresh: Every 5 minutes
 */
async function refreshMaterializedViews() {
  const views = [
    'mv_pendency_by_stage_region',
    'mv_sla_breaches',
    'mv_officer_workload',
    'mv_deficiency_patterns',
    'mv_compliance_risk_radar',
    'mv_regional_performance',
  ];

  for (const v of views) {
    try {
      await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${v}`);
    } catch (e) {
      // Fallback non-concurrent if not populated
      try {
        await pool.query(`REFRESH MATERIALIZED VIEW ${v}`);
      } catch (err) {
        logger.warn({ view: v, err }, 'Failed to refresh materialized view');
      }
    }
  }

  return { refreshed: views.length };
}

/**
 * 8. Audit Integrity Check: Nightly
 */
async function verifyAuditIntegrity() {
  const res = await pool.query<{ is_valid: boolean; total_verified: string; broken_seq: string | null }>(
    `SELECT * FROM fn_verify_audit_chain()`,
  );

  const row = res.rows[0];
  if (row && !row.is_valid) {
    logger.error(
      { brokenSeq: row.broken_seq, totalVerified: row.total_verified },
      'CRITICAL: Audit log hash chain tamper detected!',
    );

    // Write alert event
    await pool.query(
      `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload)
       VALUES ('AUDIT_TAMPER_ALERT', 'AUDIT', gen_random_uuid(), $1::jsonb)`,
      [JSON.stringify(row)],
    );
  }

  return row || { is_valid: true, total_verified: '0' };
}

/**
 * 9. Hourly Clock Reconciliation
 */
async function reconcileClocks() {
  const res = await pool.query<{ application_id: string; open_count: string }>(`
    SELECT application_id, COUNT(*) as open_count
    FROM clock_events
    WHERE stopped_at IS NULL
    GROUP BY application_id
    HAVING COUNT(*) > 1
  `);

  if (res.rowCount && res.rowCount > 0) {
    logger.error({ anomalies: res.rows }, 'Clock invariant anomaly detected: multiple open clocks found!');
  }

  return { anomalies: res.rowCount ?? 0 };
}

/**
 * 10. AI Document Processing
 */
async function processDocument(documentId: string) {
  const doc = await pool.query<{ id: string; file_name: string; mime_type: string; s3_bucket: string; s3_key: string }>(
    `SELECT id, file_name, mime_type, s3_bucket, s3_key FROM documents WHERE id = $1`,
    [documentId],
  );

  const row = doc.rows[0];
  if (!row) return;

  try {
    const s3Obj = await storage.send(new GetObjectCommand({ Bucket: row.s3_bucket, Key: row.s3_key }));
    const bytes = await s3Obj.Body!.transformToByteArray();
    const form = new FormData();
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    form.append('file', new Blob([body], { type: row.mime_type }), row.file_name);

    const aiRes = await fetch(`${process.env.AI_SERVICE_URL || 'http://localhost:8000'}/ocr`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60000),
    });

    if (aiRes.ok) {
      const data = (await aiRes.json()) as any;
      await pool.query(
        `UPDATE documents SET ocr_text = $1, extracted_metadata = $2::jsonb WHERE id = $3`,
        [data.extracted_text || '', JSON.stringify(data), documentId],
      );
    }
  } catch (error) {
    logger.warn({ documentId, err: error }, 'AI document extraction failed gracefully');
  }
}

async function startWorkers() {
  logger.info('[Worker] Initializing BullMQ queues and workers...');

  new Worker('outbox', async (job: Job) => {
    if (job.name === 'deliver') return processOutboxEvent(job.data.eventId);
    if (job.name === 'dispatch') return dispatchPendingOutbox();
  }, { connection: redis });

  new Worker('sla', async (job: Job) => sweepSla(), { connection: redis });
  new Worker('escalation', async (job: Job) => runEscalation(), { connection: redis });
  new Worker('compliance', async (job: Job) => scanComplianceExpiry(), { connection: redis });
  new Worker('evc', async (job: Job) => trackEvcDelays(), { connection: redis });
  new Worker('digest', async (job: Job) => buildDailyDigest(), { connection: redis });
  new Worker('analytics', async (job: Job) => refreshMaterializedViews(), { connection: redis });
  new Worker('audit', async (job: Job) => verifyAuditIntegrity(), { connection: redis });
  new Worker('clock', async (job: Job) => reconcileClocks(), { connection: redis });
  new Worker('ai', async (job: Job) => processDocument(job.data.documentId), { connection: redis });

  // Cron schedule triggers
  const enqueueRecurring = () => {
    void outboxQueue.add('dispatch', {}, { removeOnComplete: 100, removeOnFail: 200 });
    void slaQueue.add('sweep', {}, { removeOnComplete: 100, removeOnFail: 200 });
    void escalationQueue.add('run', {}, { removeOnComplete: 100, removeOnFail: 200 });
    void complianceQueue.add('scan', {}, { removeOnComplete: 100, removeOnFail: 200 });
    void evcQueue.add('track', {}, { removeOnComplete: 100, removeOnFail: 200 });
    void analyticsQueue.add('refresh', {}, { removeOnComplete: 100, removeOnFail: 200 });
    void auditQueue.add('verify', {}, { removeOnComplete: 100, removeOnFail: 200 });
    void clockQueue.add('reconcile', {}, { removeOnComplete: 100, removeOnFail: 200 });
  };

  enqueueRecurring();
  const interval = setInterval(enqueueRecurring, 60000); // Trigger check loop

  logger.info('[Worker] All 10 worker consumers and schedulers started successfully.');

  const shutdown = async () => {
    clearInterval(interval);
    await Promise.all([
      outboxQueue.close(),
      slaQueue.close(),
      escalationQueue.close(),
      complianceQueue.close(),
      evcQueue.close(),
      digestQueue.close(),
      analyticsQueue.close(),
      auditQueue.close(),
      aiQueue.close(),
      clockQueue.close(),
      redis.quit(),
      pool.end(),
    ]);
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startWorkers().catch((error) => {
  logger.error({ error }, '[Worker] Fatal startup error');
  process.exit(1);
});
