import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ScheduleEvcSchema, SubmitEvcReportSchema } from '@aicte/shared';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { Actor } from '../common/actor.js';
import { parseInput, response } from '../common/http.js';
import { EvcService } from './evc.service.js';
@ApiTags('EVC')
@Controller('api/v1/evc')
export class EvcController {
  constructor(private readonly evc: EvcService) {}
  @Post('schedule') async schedule(@CurrentUser() actor: Actor, @Body() body: unknown) { return response(await this.evc.schedule(actor, parseInput(ScheduleEvcSchema, body))); }
  @Post('applications/:applicationId/start') async start(@CurrentUser() actor: Actor, @Param('applicationId') applicationId: string) { return response(await this.evc.start(actor, applicationId)); }
  @Post('report') async submit(@CurrentUser() actor: Actor, @Body() body: unknown) { return response(await this.evc.submit(actor, parseInput(SubmitEvcReportSchema, body))); }
}
