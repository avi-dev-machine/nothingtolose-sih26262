import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { UserRole } from '@aicte/shared';
import { response, parseInput } from '../common/http.js';
import { DatabaseService } from '../database/database.service.js';
import { Roles } from '../auth/auth.decorator.js';
import { AuditService } from './audit.service.js';

const querySchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(25), targetId: z.string().uuid().optional() });

@ApiTags('Audit ledger')
@Controller('api/v1/audit')
@Roles(UserRole.ADMIN, UserRole.BUREAU_OFFICER)
export class AuditController {
  constructor(private readonly audit: AuditService, private readonly database: DatabaseService) {}

  @Get('verify')
  async verify() { return response(await this.audit.verify()); }

  @Get()
  async list(@Query() query: unknown) {
    const input = parseInput(querySchema, query);
    const page = input.page ?? 1;
    const limit = input.limit ?? 25;
    let builder = this.database.db.selectFrom('audit_ledger').selectAll();
    if (input.targetId) builder = builder.where('target_id', '=', input.targetId);
    const [{ count }, entries] = await Promise.all([
      (input.targetId ? this.database.db.selectFrom('audit_ledger').select((eb) => eb.fn.countAll<number>().as('count')).where('target_id', '=', input.targetId) : this.database.db.selectFrom('audit_ledger').select((eb) => eb.fn.countAll<number>().as('count'))).executeTakeFirstOrThrow(),
      builder.orderBy('sequence_number', 'desc').limit(limit).offset((page - 1) * limit).execute(),
    ]);
    return response({ items: entries, total: Number(count), page, limit, totalPages: Math.ceil(Number(count) / limit) });
  }
}
