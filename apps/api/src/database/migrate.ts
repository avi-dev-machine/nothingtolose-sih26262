import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const { Pool } = pg;

export async function runMigrations(direction: 'up' | 'down' = 'up', customConnectionString?: string) {
  const connectionString =
    customConnectionString ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/aicte_db';

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    console.log(`[Migrate] Running migrations in direction: ${direction}`);
    const migrationsDir = path.resolve(__dirname, '../../../../infra/db/migrations');

    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const files = fs.readdirSync(migrationsDir).sort();

    if (direction === 'up') {
      const upFiles = files.filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'));
      for (const file of upFiles) {
        const { rows } = await client.query('SELECT version FROM schema_migrations WHERE version = $1', [file]);
        if (rows.length === 0) {
          console.log(`[Migrate] Applying ${file}...`);
          const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
          console.log(`[Migrate] Applied ${file}`);
        } else {
          console.log(`[Migrate] Skipping ${file} (already applied)`);
        }
      }
    } else {
      const downFiles = files.filter((f) => f.endsWith('.down.sql')).reverse();
      for (const file of downFiles) {
        const upVersion = file.replace('.down.sql', '.sql');
        const { rows } = await client.query('SELECT version FROM schema_migrations WHERE version = $1', [upVersion]);
        if (rows.length > 0) {
          console.log(`[Migrate] Reverting ${file}...`);
          const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
          await client.query(sql);
          await client.query('DELETE FROM schema_migrations WHERE version = $1', [upVersion]);
          console.log(`[Migrate] Reverted ${file}`);
        }
      }
    }
    console.log('[Migrate] Migration completed successfully.');
  } catch (error) {
    console.error('[Migrate] Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  const dir = (process.argv[2] as 'up' | 'down') || 'up';
  runMigrations(dir).catch(() => process.exit(1));
}
