import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApplicationQuerySchema, CreateApplicationSchema, UserRole } from '@aicte/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/auth.decorator.js';
import type { Actor } from '../common/actor.js';
import { parseInput, response } from '../common/http.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { ApplicationsService } from './applications.service.js';

const draftUpdateSchema = z.object({
  formData: z.record(z.unknown()),
  version: z.number().int().optional(),
});

const transitionSchema = z.object({
  action: z.string(),
  reason: z.string().optional(),
  clauseId: z.string().uuid().optional(),
  payload: z.record(z.unknown()).optional(),
  expectedVersion: z.number().int().optional(),
  overrideAiFlag: z.boolean().optional(),
  overrideReason: z.string().optional(),
});

const submitSchema = z.object({
  expectedVersion: z.number().int().optional(),
});

@ApiTags('Applications')
@Controller('api/v1/applications')
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly workflow: WorkflowService,
  ) {}

  @Post()
  @Roles(UserRole.INSTITUTION)
  async create(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const input = parseInput(CreateApplicationSchema, body);
    return response(await this.applications.create(actor, input as any), 'Application draft created');
  }

  @Get()
  async list(@CurrentUser() actor: Actor, @Query() query: unknown) {
    return response(await this.applications.list(actor, parseInput(ApplicationQuerySchema, query)));
  }

  @Get(':id')
  async get(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return response(await this.applications.get(actor, id));
  }

  @Put(':id/draft')
  @Roles(UserRole.INSTITUTION)
  async updateDraft(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch?: string,
  ) {
    const input = parseInput(draftUpdateSchema, body);
    const expectedVersion = input.version !== undefined
      ? input.version
      : ifMatch ? parseInt(ifMatch.replace(/["w/]/gi, ''), 10) : undefined;

    return response(
      await this.applications.updateDraft(actor, id, input.formData, expectedVersion),
      'Draft form saved',
    );
  }

  @Post(':id/validate')
  async validate(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return response(await this.applications.validate(actor, id), 'Application validation complete');
  }

  @Post(':id/submit')
  @Roles(UserRole.INSTITUTION)
  async submit(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch?: string,
  ) {
    const input = parseInput(submitSchema.optional(), body);
    const expectedVersion = input?.expectedVersion !== undefined
      ? input.expectedVersion
      : ifMatch ? parseInt(ifMatch.replace(/["w/]/gi, ''), 10) : undefined;

    return response(
      await this.applications.submit(actor, id, expectedVersion),
      'Application successfully submitted',
    );
  }

  @Get(':id/allowed-actions')
  async getAllowedActions(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return response(await this.workflow.getAllowedActions(id, actor));
  }

  @Post(':id/transition')
  async transition(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch?: string,
  ) {
    const input = parseInput(transitionSchema, body);
    const expectedVersion = input.expectedVersion !== undefined
      ? input.expectedVersion
      : ifMatch ? parseInt(ifMatch.replace(/["w/]/gi, ''), 10) : undefined;

    return response(
      await this.workflow.transition({
        applicationId: id,
        action: input.action,
        actor,
        reason: input.reason,
        clauseId: input.clauseId,
        payload: input.payload,
        expectedVersion,
        overrideAiFlag: input.overrideAiFlag,
        overrideReason: input.overrideReason,
      }),
      'Workflow transition succeeded',
    );
  }
}
