import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { ApplicationsController } from './applications.controller.js';
import { ApplicationsService } from './applications.service.js';

@Module({ imports: [AuditModule, QueueModule, WorkflowModule], controllers: [ApplicationsController], providers: [ApplicationsService] })
export class ApplicationsModule {}
