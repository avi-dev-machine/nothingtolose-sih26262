import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminModule } from './admin/admin.module.js';
import { AiModule } from './ai/ai.module.js';
import { ApplicationsModule } from './applications/applications.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { ClockModule } from './clock/clock.module.js';
import { CommitteeModule } from './committee/committee.module.js';
import { ComplianceModule } from './compliance/compliance.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { DeficienciesModule } from './deficiencies/deficiencies.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { EvcModule } from './evc/evc.module.js';
import { HealthController } from './health.controller.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { QueueModule } from './queue/queue.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { IdempotencyService } from './common/idempotency.service.js';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';

@Module({
  imports: [
    DatabaseModule,
    QueueModule,
    RealtimeModule,
    AuthModule,
    AuditModule,
    ClockModule,
    ApplicationsModule,
    DeficienciesModule,
    EvcModule,
    CommitteeModule,
    ComplianceModule,
    DocumentsModule,
    AiModule,
    NotificationsModule,
    DashboardModule,
    AdminModule,
    TasksModule,
  ],
  controllers: [HealthController],
  providers: [
    IdempotencyService,
    IdempotencyInterceptor,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [IdempotencyService, IdempotencyInterceptor],
})
export class AppModule {}
