import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { ClockModule } from '../clock/clock.module.js';
import { WorkflowService } from './workflow.service.js';

@Module({
  imports: [AuditModule, QueueModule, RealtimeModule, ClockModule],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
