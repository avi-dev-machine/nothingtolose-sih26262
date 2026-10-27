import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { WorkflowService } from './workflow.service.js';

@Module({ imports: [AuditModule, QueueModule, RealtimeModule], providers: [WorkflowService], exports: [WorkflowService] })
export class WorkflowModule {}
