import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { EvcController } from './evc.controller.js';
import { EvcService } from './evc.service.js';
@Module({ imports: [WorkflowModule, AuditModule], controllers: [EvcController], providers: [EvcService] })
export class EvcModule {}
