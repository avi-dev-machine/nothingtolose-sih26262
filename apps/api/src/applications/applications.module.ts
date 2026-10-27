import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { ClockModule } from '../clock/clock.module.js';
import { ApplicationsController } from './applications.controller.js';
import { ApplicationsService } from './applications.service.js';
import { ValidationEngineService } from './validation-engine.service.js';

@Module({
  imports: [AuditModule, QueueModule, WorkflowModule, ClockModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, ValidationEngineService],
  exports: [ApplicationsService, ValidationEngineService],
})
export class ApplicationsModule {}
