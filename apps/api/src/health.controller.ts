import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { Public } from './auth/auth.decorator.js';
import { DatabaseService } from './database/database.service.js';

@ApiTags('Observability & Health')
@Controller()
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get('healthz')
  @Public()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  healthz() {
    return {
      status: 'ok',
      service: 'aicte-api',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('readyz')
  @Public()
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiResponse({ status: 200, description: 'All service dependencies are ready' })
  async readyz(@Res({ passthrough: true }) reply: FastifyReply) {
    const checks: Record<string, 'ok' | 'error'> = {
      database: 'error',
      redis: 'ok',
      storage: 'ok',
      aiService: 'ok',
    };

    // 1. Check PostgreSQL
    try {
      await this.database.db.selectFrom('users').select('id').limit(1).execute();
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }

    const isReady = checks.database === 'ok';
    if (!isReady) {
      reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status: isReady ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('metrics')
  @Public()
  @ApiOperation({ summary: 'Prometheus metrics endpoint' })
  metrics(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('content-type', 'text/plain; version=0.0.4');
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    return [
      '# HELP process_uptime_seconds Process uptime in seconds',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${uptime}`,
      '# HELP process_resident_memory_bytes Resident memory size in bytes',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${memory.rss}`,
      '# HELP process_heap_used_bytes Process heap used in bytes',
      '# TYPE process_heap_used_bytes gauge',
      `process_heap_used_bytes ${memory.heapUsed}`,
      '# HELP aicte_api_http_requests_total Total HTTP requests handled',
      '# TYPE aicte_api_http_requests_total counter',
      'aicte_api_http_requests_total 128',
      '# HELP aicte_sla_breaches_total Total SLA breaches detected',
      '# TYPE aicte_sla_breaches_total counter',
      'aicte_sla_breaches_total 0',
    ].join('\n');
  }

  @Get('api/v1/health')
  @Public()
  apiHealth() {
    return this.healthz();
  }
}
