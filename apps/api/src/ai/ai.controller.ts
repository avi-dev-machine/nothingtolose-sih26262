import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { Actor } from '../common/actor.js';
import { parseInput, response } from '../common/http.js';
import { AiService } from './ai.service.js';
const aphSchema = z.object({ applicationId: z.string().uuid(), query: z.string().min(5) });
const overrideSchema = z.object({ reason: z.string().min(10) });
@ApiTags('AI assistance — suggestions only')
@Controller('api/v1/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}
  @Post('delay-risk/:applicationId') async delayRisk(@CurrentUser() actor: Actor, @Param('applicationId') applicationId: string) { return response(await this.ai.delayRisk(actor, applicationId)); }
  @Post('aph-query') async aphQuery(@CurrentUser() actor: Actor, @Body() body: unknown) { const input = parseInput(aphSchema, body); return response(await this.ai.aphQuery(actor, input.applicationId, input.query)); }
  @Post('suggestions/:id/override') async override(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() body: unknown) { return response(await this.ai.override(actor, id, parseInput(overrideSchema, body).reason)); }
}
