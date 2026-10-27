import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import { Database } from './types.js';
import type { Actor } from '../common/actor.js';

const { Pool } = pg;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  public db!: Kysely<Database>;
  private pool!: pg.Pool;

  onModuleInit() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/aicte_db',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    const dialect = new PostgresDialect({
      pool: this.pool,
    });

    this.db = new Kysely<Database>({
      dialect,
    });
  }

  /**
   * Runs an operation inside a database transaction scoped with Row-Level Security variables.
   */
  async withUserContext<T>(
    actor: Actor,
    operation: (trx: Transaction<Database>) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await sql`
        SELECT
          set_config('app.user_id', ${actor.id}, true),
          set_config('app.role', ${actor.role}, true),
          set_config('app.region_id', ${actor.regionId || ''}, true),
          set_config('app.institution_id', ${actor.institutionId || ''}, true)
      `.execute(trx);

      return operation(trx);
    });
  }

  async onModuleDestroy() {
    if (this.db) {
      await this.db.destroy();
    }
    if (this.pool) {
      await this.pool.end();
    }
  }
}
