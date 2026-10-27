import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@aicte/shared';
import { z } from 'zod';
import { Roles } from '../auth/auth.decorator.js';
import { parseInput, response } from '../common/http.js';
import { ClockService } from './clock.service.js';

const advanceSchema = z.object({
  hours: z.number().positive(),
});

@ApiTags('Dual clocks')
@Controller('api/v1')
export class ClockController {
  constructor(private readonly clocks: ClockService) {}

  @Get('applications/:id/clocks')
  async getSummary(@Param('id') id: string) {
    return response(await this.clocks.summary(id));
  }

  @Get('applications/:id/clock')
  async getSummaryAlias(@Param('id') id: string) {
    return response(await this.clocks.summary(id));
  }

  @Get('clock/status')
  async getClockStatus() {
    return response(this.clocks.getClockState());
  }

  @Post('admin/time-travel')
  @Roles(UserRole.ADMIN)
  async advanceTime(@Body() body: unknown) {
    const input = parseInput(advanceSchema, body);
    return response(this.clocks.advanceTime(input.hours), `Virtual clock advanced by ${input.hours} hours`);
  }

  @Post('admin/time-travel/reset')
  @Roles(UserRole.ADMIN)
  async resetTime() {
    return response(this.clocks.resetTime(), 'Virtual clock reset to real-time');
  }

  @Post('clocks/reconcile')
  @Roles(UserRole.ADMIN, UserRole.BUREAU_OFFICER)
  async reconcile() {
    return response(await this.clocks.reconcileClocks(), 'Clock reconciliation completed');
  }
}
