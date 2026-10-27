import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@aicte/shared';
import type { Actor } from '../common/actor.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ClockService } from '../clock/clock.service.js';

@Injectable()
export class TasksService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  async getMyTasks(actor: Actor, query: { status?: string; page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    let q = this.database.db
      .selectFrom('tasks')
      .innerJoin('applications', 'applications.id', 'tasks.application_id')
      .innerJoin('institutions', 'institutions.id', 'applications.institution_id')
      .selectAll('tasks')
      .select([
        'applications.ref_no',
        'applications.track',
        'institutions.name as institution_name',
        'institutions.code as institution_code',
      ])
      .where('tasks.assignee_id', '=', actor.id);

    if (query.status) {
      q = q.where('tasks.status', '=', query.status as any);
    } else {
      q = q.where('tasks.status', '=', 'OPEN');
    }

    const items = await q
      .orderBy('tasks.due_at', 'asc')
      .limit(limit)
      .offset((page - 1) * limit)
      .execute();

    return { items, page, limit };
  }

  async getTeamTasks(actor: Actor, query: { regionId?: string; status?: string; page?: number; limit?: number }) {
    this.requireOfficer(actor);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    let q = this.database.db
      .selectFrom('tasks')
      .innerJoin('applications', 'applications.id', 'tasks.application_id')
      .innerJoin('institutions', 'institutions.id', 'applications.institution_id')
      .innerJoin('users', 'users.id', 'tasks.assignee_id')
      .selectAll('tasks')
      .select([
        'applications.ref_no',
        'applications.track',
        'institutions.name as institution_name',
        'institutions.region_id',
        'users.full_name as assignee_name',
        'users.email as assignee_email',
      ]);

    if (!['ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.regionId) {
      q = q.where('institutions.region_id', '=', actor.regionId);
    } else if (query.regionId) {
      q = q.where('institutions.region_id', '=', query.regionId);
    }

    if (query.status) {
      q = q.where('tasks.status', '=', query.status as any);
    } else {
      q = q.where('tasks.status', '=', 'OPEN');
    }

    const items = await q
      .orderBy('tasks.due_at', 'asc')
      .limit(limit)
      .offset((page - 1) * limit)
      .execute();

    return { items, page, limit };
  }

  async reassign(actor: Actor, taskId: string, newAssigneeId: string, reason: string) {
    this.requireOfficer(actor);
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('A reason of at least 5 characters is required for reassignment');
    }

    return this.database.db.transaction().execute(async (trx) => {
      const task = await trx
        .selectFrom('tasks')
        .innerJoin('applications', 'applications.id', 'tasks.application_id')
        .selectAll('tasks')
        .select(['applications.region_id', 'applications.ref_no'])
        .where('tasks.id', '=', taskId)
        .forUpdate()
        .executeTakeFirst();

      if (!task) throw new NotFoundException('Task not found');

      const newAssignee = await trx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', newAssigneeId)
        .executeTakeFirst();

      if (!newAssignee) throw new NotFoundException('Target assignee user not found');
      if (!newAssignee.is_active) throw new BadRequestException('Target user is inactive');

      const now = this.clock.now();

      // Record reassignment
      await trx
        .insertInto('reassignments')
        .values({
          task_id: task.id,
          from_user: task.assignee_id,
          to_user: newAssigneeId,
          reason,
          by_user: actor.id,
          at: now,
        })
        .execute();

      // Update task assignee
      const updated = await trx
        .updateTable('tasks')
        .set({
          assignee_id: newAssigneeId,
          assignee_role: newAssignee.role,
        })
        .where('id', '=', taskId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Update application owner if matching
      await trx
        .updateTable('applications')
        .set({
          current_owner_id: newAssigneeId,
          current_owner_role: newAssignee.role,
          updated_at: now,
        })
        .where('id', '=', task.application_id)
        .where('current_owner_id', '=', task.assignee_id)
        .execute();

      await this.audit.append(trx, actor, {
        action: 'TASK_REASSIGNED',
        entityType: 'TASK',
        entityId: task.id,
        applicationId: task.application_id,
        payload: {
          taskId: task.id,
          fromUserId: task.assignee_id,
          toUserId: newAssigneeId,
          reason,
        },
      });

      // Outbox notification to new assignee
      await trx
        .insertInto('outbox_events')
        .values({
          topic: 'TASK_ASSIGNED',
          aggregate_type: 'TASK',
          aggregate_id: task.id,
          payload: {
            taskId: task.id,
            assigneeId: newAssigneeId,
            applicationId: task.application_id,
            refNo: (task as any).ref_no,
            reason,
          },
        })
        .execute();

      return updated;
    });
  }

  async previewBulkReassign(actor: Actor, fromUserId: string, toUserId: string) {
    this.requireOfficer(actor);
    const tasks = await this.database.db
      .selectFrom('tasks')
      .innerJoin('applications', 'applications.id', 'tasks.application_id')
      .selectAll('tasks')
      .select(['applications.ref_no'])
      .where('tasks.assignee_id', '=', fromUserId)
      .where('tasks.status', '=', 'OPEN')
      .execute();

    return {
      eligibleTaskCount: tasks.length,
      tasks: tasks.map((t) => ({ id: t.id, kind: t.kind, refNo: (t as any).ref_no, dueAt: t.due_at })),
    };
  }

  async confirmBulkReassign(actor: Actor, fromUserId: string, toUserId: string, reason: string) {
    this.requireOfficer(actor);
    const preview = await this.previewBulkReassign(actor, fromUserId, toUserId);
    for (const t of preview.tasks) {
      await this.reassign(actor, t.id, toUserId, reason);
    }
    return { reassignedCount: preview.eligibleTaskCount };
  }

  async bulkRemind(actor: Actor, taskIds: string[], message?: string) {
    this.requireOfficer(actor);
    const tasks = await this.database.db
      .selectFrom('tasks')
      .innerJoin('users', 'users.id', 'tasks.assignee_id')
      .selectAll('tasks')
      .select(['users.email', 'users.full_name'])
      .where('tasks.id', 'in', taskIds)
      .where('tasks.status', '=', 'OPEN')
      .execute();

    for (const t of tasks) {
      await this.database.db.insertInto('outbox_events').values({
        topic: 'TASK_REMINDER',
        aggregate_type: 'TASK',
        aggregate_id: t.id,
        payload: {
          taskId: t.id,
          recipientId: t.assignee_id,
          email: (t as any).email,
          message: message || `Reminder: Task for application is pending and due at ${t.due_at.toISOString()}`,
        },
      }).execute();
    }

    return { remindedCount: tasks.length };
  }

  private requireOfficer(actor: Actor) {
    if (!['ADMIN', 'BUREAU_OFFICER', 'REGIONAL_OFFICER'].includes(actor.role)) {
      throw new ForbiddenException('Only officers may manage tasks and workloads');
    }
  }
}
