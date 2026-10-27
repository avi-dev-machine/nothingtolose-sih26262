import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
@Module({ imports: [AuditModule], controllers: [AiController], providers: [AiService] })
export class AiModule {}
