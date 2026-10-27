import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/aicte_db', max: 10 });
const redis = new Redis({ host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379), password: process.env.REDIS_PASSWORD || undefined, maxRetriesPerRequest: null });
const notificationsQueue = new Queue('notifications', { connection: redis });
const clockQueue = new Queue('clock-escalation', { connection: redis });
const complianceQueue = new Queue('compliance-radar', { connection: redis });
const storage = new S3Client({ endpoint: `${process.env.S3_USE_SSL === 'true' ? 'https' : 'http'}://${process.env.S3_ENDPOINT || 'localhost'}:${process.env.S3_PORT || '9000'}`, forcePathStyle: true, region: process.env.S3_REGION || 'us-east-1', credentials: { accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin', secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin' } });

async function deliverOutbox(eventId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query<{ id: string; topic: string; payload: Record<string, unknown> }>('UPDATE outbox_events SET dispatched_at = NOW(), attempts = attempts + 1 WHERE id = $1 AND dispatched_at IS NULL RETURNING id, topic, payload', [eventId]);
    const event = claimed.rows[0];
    if (!event) { await client.query('COMMIT'); return { skipped: true }; }
    const payload = event.payload;
    if (event.topic === 'WORKFLOW_TRANSITION') {
      const recipients = await client.query<{ id: string }>('SELECT id FROM users WHERE institution_id = $1', [String(payload.institutionId)]);
      for (const recipient of recipients.rows) {
        await client.query(`INSERT INTO notifications (recipient_id, channel, title, message, metadata) VALUES ($1, 'IN_APP', $2, $3, $4::jsonb)`, [recipient.id, `Application ${String(payload.applicationNumber)} moved to ${String(payload.state)}`, `Your application moved from ${String(payload.fromState)} to ${String(payload.state)}. ${String(payload.reason)}`, JSON.stringify(payload)]);
      }
    }
    await client.query('COMMIT');
    return { delivered: true, topic: event.topic };
  } catch (error) {
    await client.query('ROLLBACK');
    await pool.query('UPDATE outbox_events SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [eventId, error instanceof Error ? error.message : String(error)]);
    throw error;
  } finally { client.release(); }
}

async function dispatchPendingOutbox() {
  const pending = await pool.query<{ id: string }>('SELECT id FROM outbox_events WHERE dispatched_at IS NULL ORDER BY created_at ASC LIMIT 100');
  await Promise.all(pending.rows.map((row) => notificationsQueue.add('deliver-outbox-event', { eventId: row.id }, { jobId: `outbox:${row.id}`, removeOnComplete: 1000, removeOnFail: 5000 })));
  return { queued: pending.rowCount ?? 0 };
}

async function evaluateClocks() {
  const rows = await pool.query<{ id: string; application_number: string; institution_id: string; sla_hours: number; escalation_after_hours: number; elapsed_hours: number }>(`SELECT a.id, a.application_number, a.institution_id, s.sla_hours, s.escalation_after_hours, EXTRACT(EPOCH FROM (NOW() - COALESCE(last_clock.timestamp, a.updated_at))) / 3600 AS elapsed_hours FROM applications a JOIN sla_configs s ON s.state = a.state AND s.is_active = TRUE LEFT JOIN LATERAL (SELECT timestamp FROM clock_events WHERE application_id = a.id ORDER BY timestamp DESC LIMIT 1) last_clock ON TRUE WHERE a.state NOT IN ('APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'COMPLIANCE_REQUIRED')`);
  let escalated = 0;
  for (const row of rows.rows) {
    if (Number(row.elapsed_hours) < Number(row.sla_hours)) continue;
    const slaStatus = Number(row.elapsed_hours) >= Number(row.escalation_after_hours) ? 'CRITICAL_ESCALATION' : 'BREACHED';
    const exists = await pool.query("SELECT 1 FROM outbox_events WHERE topic = $1 AND aggregate_id = $2 AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1", ['SLA_ESCALATION', row.id]);
    if (exists.rowCount) continue;
    await pool.query("INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload) VALUES ('SLA_ESCALATION', 'APPLICATION', $1, $2::jsonb)", [row.id, JSON.stringify({ applicationId: row.id, applicationNumber: row.application_number, institutionId: row.institution_id, slaStatus, elapsedHours: Number(row.elapsed_hours) })]);
    escalated += 1;
  }
  return { evaluated: rows.rowCount ?? 0, escalated };
}

async function scanCompliance() {
  const records = await pool.query<{ id: string; institution_id: string; title: string; expiry_date: Date; alert_before_days: number; status: string }>('SELECT id, institution_id, title, expiry_date, alert_before_days, status FROM compliance_records');
  let updated = 0;
  for (const record of records.rows) {
    const days = (new Date(record.expiry_date).getTime() - Date.now()) / 86_400_000;
    const next = days < 0 ? 'EXPIRED' : days <= record.alert_before_days ? 'EXPIRING_SOON' : 'VALID';
    if (record.status === 'UNDER_RENEWAL' || record.status === 'WAIVED' || record.status === next) continue;
    await pool.query('UPDATE compliance_records SET status = $2, updated_at = NOW() WHERE id = $1', [record.id, next]);
    await pool.query("INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload) VALUES ('COMPLIANCE_EXPIRY', 'COMPLIANCE_RECORD', $1, $2::jsonb)", [record.id, JSON.stringify({ complianceId: record.id, institutionId: record.institution_id, title: record.title, expiryDate: new Date(record.expiry_date).toISOString(), status: next })]);
    updated += 1;
  }
  return { scanned: records.rowCount ?? 0, updated };
}

async function processDocument(documentId: string) {
  const document = await pool.query<{ id: string; file_name: string; mime_type: string; s3_bucket: string; s3_key: string }>('SELECT id, file_name, mime_type, s3_bucket, s3_key FROM documents WHERE id = $1', [documentId]);
  const row = document.rows[0];
  if (!row) throw new Error(`Document ${documentId} does not exist`);
  const object = await storage.send(new GetObjectCommand({ Bucket: row.s3_bucket, Key: row.s3_key }));
  if (!object.Body) throw new Error(`Document ${documentId} has no storage body`);
  const bytes = await object.Body.transformToByteArray();
  const form = new FormData();
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.append('file', new Blob([body], { type: row.mime_type }), row.file_name);
  const response = await fetch(`${process.env.AI_SERVICE_URL || 'http://localhost:8000'}/ocr/extract`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`AI OCR service responded ${response.status}`);
  const output = await response.json() as { extracted_text?: string; detected_type?: string; extracted_expiry_date?: string | null; confidence?: number; metadata?: Record<string, unknown> };
  await pool.query('UPDATE documents SET classification = $2, extracted_metadata = $3::jsonb, ocr_text = $4 WHERE id = $1', [documentId, output.detected_type ?? null, JSON.stringify({ ...(output.metadata ?? {}), extractedExpiryDate: output.extracted_expiry_date ?? null, confidence: output.confidence ?? null, processedAt: new Date().toISOString() }), output.extracted_text ?? null]);
  return { documentId, classification: output.detected_type, confidence: output.confidence };
}

async function startWorkers() {
  const notificationWorker = new Worker('notifications', async (job) => job.name === 'deliver-outbox-event' ? deliverOutbox(String(job.data.eventId)) : job.name === 'dispatch-outbox' ? dispatchPendingOutbox() : Promise.reject(new Error(`Unknown notifications job: ${job.name}`)), { connection: redis });
  const clockWorker = new Worker('clock-escalation', async (job) => job.name === 'evaluate' ? evaluateClocks() : Promise.reject(new Error(`Unknown clock job: ${job.name}`)), { connection: redis });
  const complianceWorker = new Worker('compliance-radar', async (job) => job.name === 'scan' ? scanCompliance() : Promise.reject(new Error(`Unknown compliance job: ${job.name}`)), { connection: redis });
  const documentWorker = new Worker('document-processing', async (job) => job.name === 'classify-document' ? processDocument(String(job.data.documentId)) : Promise.reject(new Error(`Unknown document job: ${job.name}`)), { connection: redis });
  const enqueueScans = () => { const now = Date.now(); void notificationsQueue.add('dispatch-outbox', {}, { jobId: `outbox-scan:${Math.floor(now / 60_000)}`, removeOnComplete: 60, removeOnFail: 120 }); void clockQueue.add('evaluate', {}, { jobId: `clock:${Math.floor(now / 900_000)}`, removeOnComplete: 96, removeOnFail: 96 }); void complianceQueue.add('scan', {}, { jobId: `compliance:${Math.floor(now / 900_000)}`, removeOnComplete: 96, removeOnFail: 96 }); };
  enqueueScans();
  const interval = setInterval(enqueueScans, 60_000);
  console.log('[Worker] notifications, clock-escalation, compliance-radar and document-processing workers are running');
  const shutdown = async () => { clearInterval(interval); await Promise.all([notificationWorker.close(), clockWorker.close(), complianceWorker.close(), documentWorker.close(), notificationsQueue.close(), clockQueue.close(), complianceQueue.close(), redis.quit(), pool.end()]); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
startWorkers().catch((error) => { console.error('[Worker] Fatal startup failure', error); process.exit(1); });
