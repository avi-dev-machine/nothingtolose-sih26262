import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateDeficiencySchema, ResolveDeficiencySchema, RespondDeficiencySchema } from '@aicte/shared';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { Actor } from '../common/actor.js';
import { parseInput, response } from '../common/http.js';
import { DeficienciesService } from './deficiencies.service.js';

@ApiTags('Deficiencies')
@Controller('api/v1')
export class DeficienciesController {
  constructor(private readonly deficiencies: DeficienciesService) {}
  @Post('deficiencies')
  async create(@CurrentUser() actor: Actor, @Body() body: unknown) { return response(await this.deficiencies.create(actor, parseInput(CreateDeficiencySchema, body))); }
  @Post('deficiencies/respond')
  async respond(@CurrentUser() actor: Actor, @Body() body: unknown) { return response(await this.deficiencies.respond(actor, parseInput(RespondDeficiencySchema, body))); }
  @Post('deficiencies/resolve')
  async resolve(@CurrentUser() actor: Actor, @Body() body: unknown) { return response(await this.deficiencies.resolve(actor, parseInput(ResolveDeficiencySchema, body))); }
  @Get('applications/:applicationId/deficiencies')
  async list(@CurrentUser() actor: Actor, @Param('applicationId') applicationId: string) { return response(await this.deficiencies.list(actor, applicationId)); }
}
