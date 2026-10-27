import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from './auth/auth.decorator.js';

@ApiTags('Health')
@Controller('api/v1/health')
export class HealthController {
  @Get()
  @Public()
  @ApiOperation({ summary: 'Check API and system health' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  check() {
    return {
      status: 'ok',
      service: 'aicte-api',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
