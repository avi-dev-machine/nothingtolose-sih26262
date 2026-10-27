import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { Actor } from '../common/actor.js';
import { parseInput, response } from '../common/http.js';
import { CommitteeService, FinalizeDecisionSchema, RecordDecisionSchema } from './committee.service.js';
@ApiTags('Committee decisions')
@Controller('api/v1/committee')
export class CommitteeController {
  constructor(private readonly committee: CommitteeService) {}
  @Post('decisions') async record(@CurrentUser() actor: Actor, @Body() body: unknown) { return response(await this.committee.record(actor, parseInput(RecordDecisionSchema, body))); }
  @Post('applications/:applicationId/finalize') async finalize(@CurrentUser() actor: Actor, @Param('applicationId') applicationId: string, @Body() body: unknown) { return response(await this.committee.finalize(actor, applicationId, parseInput(FinalizeDecisionSchema, body))); }
}
