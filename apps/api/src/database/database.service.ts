import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { Database } from './types.js';

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

  async onModuleDestroy() {
    if (this.db) {
      await this.db.destroy();
    }
    if (this.pool) {
      await this.pool.end();
    }
  }
}
