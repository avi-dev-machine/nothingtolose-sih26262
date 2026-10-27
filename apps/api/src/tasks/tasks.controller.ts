import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { Actor } from '../common/actor.js';
import { parseInput, response } from '../common/http.js';
import { TasksService } from './tasks.service.js';

const reassignSchema = z.object({
  newAssigneeId: z.string().uuid(),
  reason: z.string().min(5),
});

const bulkPreviewSchema = z.object({
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
});

const bulkConfirmSchema = z.object({
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
  reason: z.string().min(5),
});

const bulkRemindSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1),
  message: z.string().optional(),
});

@ApiTags('Tasks & Workload')
@Controller('api/v1/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('my')
  async getMyTasks(@CurrentUser() actor: Actor, @Query() query: any) {
    return response(await this.tasks.getMyTasks(actor, query));
  }

  @Get('team')
  async getTeamTasks(@CurrentUser() actor: Actor, @Query() query: any) {
    return response(await this.tasks.getTeamTasks(actor, query));
  }

  @Patch(':id/reassign')
  async reassign(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const input = parseInput(reassignSchema, body);
    return response(await this.tasks.reassign(actor, id, input.newAssigneeId, input.reason), 'Task reassigned successfully');
  }

  @Post('bulk-reassign/preview')
  async previewBulk(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const input = parseInput(bulkPreviewSchema, body);
    return response(await this.tasks.previewBulkReassign(actor, input.fromUserId, input.toUserId));
  }

  @Post('bulk-reassign')
  async confirmBulk(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const input = parseInput(bulkConfirmSchema, body);
    return response(await this.tasks.confirmBulkReassign(actor, input.fromUserId, input.toUserId, input.reason), 'Tasks reassigned');
  }

  @Post('bulk-remind')
  async bulkRemind(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const input = parseInput(bulkRemindSchema, body);
    return response(await this.tasks.bulkRemind(actor, input.taskIds, input.message), 'Reminders dispatched');
  }
}
