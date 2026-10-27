import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const { Pool } = pg;

export async function runDatabaseTests(customConnectionString?: string) {
  const connectionString =
    customConnectionString ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/aicte_db';

  console.log('[DB Test Runner] Starting test execution against:', connectionString);
  const pool = new Pool({ connectionString, max: 20 });
  const client = await pool.connect();

  let passedTests = 0;
  let totalTests = 0;

  try {
    const testFiles = [
      '01_test_migrations.sql',
      '02_test_state_machine_guard.sql',
      '03_test_audit_immutability.sql',
      '04_test_audit_hash_chain.sql',
      '05_test_dual_clock_exclusion.sql',
      '06_test_rls_isolation.sql',
      '07_test_idempotent_alerts.sql',
    ];

    for (const testFile of testFiles) {
      totalTests++;
      console.log(`[DB Test] Running ${testFile}...`);
      const filePath = path.join(__dirname, testFile);
      const sql = fs.readFileSync(filePath, 'utf8');

      try {
        await client.query(sql);
        console.log(`[DB Test] PASS: ${testFile}`);
        passedTests++;
      } catch (err: any) {
        console.error(`[DB Test] FAIL: ${testFile}:`, err.message);
      }
    }

    // 8. 200 Concurrent Audit Inserts Test
    totalTests++;
    console.log('[DB Test] Testing 200 Concurrent Audit Inserts for unbroken chain...');
    try {
      const { rows: startRow } = await client.query('SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM audit_log');
      const startSeq = Number(startRow[0].next_seq);

      const actorRes = await client.query('SELECT id FROM users LIMIT 1');
      const actorId = actorRes.rows.length > 0 ? actorRes.rows[0].id : '00000000-0000-0000-0000-000000000001';

      // Launch 200 concurrent insert queries across pool clients
      const insertPromises = Array.from({ length: 200 }, (_, idx) => {
        return pool.query(
          `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, payload)
           VALUES ($1, 'ADMIN', 'CONCURRENT_INSERT_TEST', 'STRESS_TEST', gen_random_uuid(), $2)`,
          [actorId, JSON.stringify({ index: idx, timestamp: Date.now() })]
        );
      });

      await Promise.all(insertPromises);

      const { rows: endRow } = await client.query('SELECT MAX(seq) AS max_seq FROM audit_log');
      const endSeq = Number(endRow[0].max_seq);

      // Verify audit chain
      const { rows: verifyRows } = await client.query('SELECT fn_verify_audit_chain($1, $2) AS broken_seq', [
        startSeq,
        endSeq,
      ]);

      const brokenSeq = verifyRows[0].broken_seq;
      if (brokenSeq === null) {
        console.log(`[DB Test] PASS: 200 concurrent audit inserts completed without chain break! (seq ${startSeq} to ${endSeq})`);
        passedTests++;
      } else {
        console.error(`[DB Test] FAIL: Audit chain broken at sequence ${brokenSeq}`);
      }
    } catch (err: any) {
      console.error('[DB Test] FAIL: 200 concurrent audit inserts encountered error:', err.message);
    }

    console.log(`\n========================================`);
    console.log(`[DB Test Summary] ${passedTests} / ${totalTests} tests passed.`);
    console.log(`========================================\n`);

    if (passedTests !== totalTests) {
      throw new Error(`DB Tests failed: ${totalTests - passedTests} failed.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('run_db_tests.ts')) {
  runDatabaseTests().catch(() => process.exit(1));
}
