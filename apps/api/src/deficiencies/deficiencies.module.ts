import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { DeficienciesController } from './deficiencies.controller.js';
import { DeficienciesService } from './deficiencies.service.js';
@Module({ imports: [WorkflowModule, AuditModule], controllers: [DeficienciesController], providers: [DeficienciesService] })
export class DeficienciesModule {}
