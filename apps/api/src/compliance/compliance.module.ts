import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { ComplianceController } from './compliance.controller.js';
import { ComplianceService } from './compliance.service.js';
@Module({ imports: [AuditModule], controllers: [ComplianceController], providers: [ComplianceService] })
export class ComplianceModule {}
