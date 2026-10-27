import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { CommitteeController } from './committee.controller.js';
import { CommitteeService } from './committee.service.js';
@Module({ imports: [WorkflowModule, AuditModule], controllers: [CommitteeController], providers: [CommitteeService] })
export class CommitteeModule {}
