import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ComplianceRadarQuerySchema, CreateComplianceSchema, UpdateComplianceSchema } from '@aicte/shared';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { Actor } from '../common/actor.js';
import { parseInput, response } from '../common/http.js';
import { ComplianceService } from './compliance.service.js';
@ApiTags('Compliance radar')
@Controller('api/v1/compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}
  @Post() async create(@CurrentUser() actor: Actor, @Body() body: unknown) { return response(await this.compliance.create(actor, parseInput(CreateComplianceSchema, body))); }
  @Patch(':id') async update(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() body: unknown) { return response(await this.compliance.update(actor, id, parseInput(UpdateComplianceSchema, body))); }
  @Get('radar') async radar(@CurrentUser() actor: Actor, @Query() query: unknown) { return response(await this.compliance.radar(actor, parseInput(ComplianceRadarQuerySchema, query))); }
}
