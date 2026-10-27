import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { response } from '../common/http.js';
import { ClockService } from './clock.service.js';

@ApiTags('Dual clocks')
@Controller('api/v1/applications')
export class ClockController {
  constructor(private readonly clocks: ClockService) {}
  @Get(':id/clock')
  async getSummary(@Param('id') id: string) { return response(await this.clocks.summary(id)); }
}
