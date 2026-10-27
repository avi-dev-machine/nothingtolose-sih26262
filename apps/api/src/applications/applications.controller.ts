import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApplicationQuerySchema, CreateApplicationSchema, TransitionStateSchema, UserRole } from '@aicte/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/auth.decorator.js';
import type { Actor } from '../common/actor.js';
import { parseInput, response } from '../common/http.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { ApplicationsService } from './applications.service.js';

const assignmentSchema = z.object({ assigneeId: z.string().uuid(), dueAt: z.string().datetime().optional() });

@ApiTags('Applications')
@Controller('api/v1/applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService, private readonly workflow: WorkflowService) {}

  @Post()
  @Roles(UserRole.INSTITUTION)
  async create(@CurrentUser() actor: Actor, @Body() body: unknown) { return response(await this.applications.create(actor, parseInput(CreateApplicationSchema, body)), 'Application draft created'); }

  @Get()
  async list(@CurrentUser() actor: Actor, @Query() query: unknown) { return response(await this.applications.list(actor, parseInput(ApplicationQuerySchema, query))); }

  @Get(':id')
  async get(@CurrentUser() actor: Actor, @Param('id') id: string) { return response(await this.applications.get(actor, id)); }

  @Post(':id/transition')
  async transition(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() body: unknown) { return response(await this.workflow.transition(id, actor, parseInput(TransitionStateSchema, body)), 'Workflow state updated'); }

  @Patch(':id/assignment')
  @Roles(UserRole.ADMIN, UserRole.BUREAU_OFFICER, UserRole.REGIONAL_OFFICER)
  async assign(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() body: unknown) { const input = parseInput(assignmentSchema, body); return response(await this.applications.assign(actor, id, input.assigneeId, input.dueAt), 'Scrutiny task assigned'); }
}
