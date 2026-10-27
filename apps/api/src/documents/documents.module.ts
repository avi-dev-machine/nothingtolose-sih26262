import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
@Module({ imports: [AuditModule, QueueModule], controllers: [DocumentsController], providers: [DocumentsService], exports: [DocumentsService] })
export class DocumentsModule {}
