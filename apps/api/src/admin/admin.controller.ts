import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RegisterUserSchema, UserRole } from '@aicte/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/auth.decorator.js';
import { AuthService } from '../auth/auth.service.js';
import type { Actor } from '../common/actor.js';
import { parseInput, response } from '../common/http.js';
import { DatabaseService } from '../database/database.service.js';

const workflowRuleSchema = z.object({ id: z.string().uuid(), allowedRoles: z.array(z.nativeEnum(UserRole)).min(1), requiredGates: z.array(z.enum(['OPEN_DEFICIENCY', 'RESPONDED_DEFICIENCY', 'NO_OPEN_DEFICIENCIES', 'EVC_VISIT_SCHEDULED', 'EVC_REPORT_COMPLETED', 'COMMITTEE_DECISION_RECORDED'])), isActive: z.boolean().optional() });
const slaSchema = z.object({ state: z.string().min(1), slaHours: z.number().int().positive(), nearBreachPercent: z.number().min(0).max(100), escalationAfterHours: z.number().int().nonnegative(), escalationRoles: z.array(z.nativeEnum(UserRole)), isActive: z.boolean().optional() });

@ApiTags('Administration')
@Controller('api/v1/admin')
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly database: DatabaseService, private readonly auth: AuthService) {}
  @Get('users') async users() { return response(await this.database.db.selectFrom('users').select(['id', 'email', 'full_name', 'role', 'institution_id', 'region_id', 'is_totp_enabled', 'first_login_must_change_pwd', 'created_at']).orderBy('created_at', 'desc').execute()); }
  @Post('users') async createUser(@Body() body: unknown) { return response(await this.auth.createUser(parseInput(RegisterUserSchema, body)), 'User created; password change is required at first login'); }
  @Get('workflow-rules') async workflowRules() { return response(await this.database.db.selectFrom('workflow_rules').selectAll().orderBy('track', 'asc').orderBy('from_state', 'asc').execute()); }
  @Patch('workflow-rules') async updateWorkflowRule(@Body() body: unknown) { const input = parseInput(workflowRuleSchema, body); const row = await this.database.db.updateTable('workflow_rules').set({ allowed_roles: input.allowedRoles, required_gates: input.requiredGates, is_active: input.isActive ?? true, updated_at: new Date() }).where('id', '=', input.id).returningAll().executeTakeFirst(); return response(row); }
  @Get('sla-configs') async slaConfigs() { return response(await this.database.db.selectFrom('sla_configs').selectAll().orderBy('state', 'asc').execute()); }
  @Patch('sla-configs') async updateSla(@Body() body: unknown) { const input = parseInput(slaSchema, body); const row = await this.database.db.insertInto('sla_configs').values({ state: input.state, sla_hours: input.slaHours, near_breach_percent: input.nearBreachPercent, escalation_after_hours: input.escalationAfterHours, escalation_roles: input.escalationRoles, is_active: input.isActive ?? true }).onConflict((oc) => oc.column('state').doUpdateSet({ sla_hours: input.slaHours, near_breach_percent: input.nearBreachPercent, escalation_after_hours: input.escalationAfterHours, escalation_roles: input.escalationRoles, is_active: input.isActive ?? true, updated_at: new Date() })).returningAll().executeTakeFirstOrThrow(); return response(row); }
}
