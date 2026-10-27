import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { ClockModule } from '../clock/clock.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [AuditModule, ClockModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
