import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { Actor } from '../common/actor.js';
import { response } from '../common/http.js';
import { DatabaseService } from '../database/database.service.js';
@ApiTags('Control tower dashboards')
@Controller('api/v1/dashboard')
export class DashboardController {
  constructor(private readonly database: DatabaseService) {}
  @Get('pendency')
  async pendency(@CurrentUser() actor: Actor) {
    let applications: any = this.database.db.selectFrom('applications').select(['state', 'track', 'region_id']);
    if (actor.role === 'INSTITUTION') applications = applications.where('institution_id', '=', actor.institutionId ?? '');
    else if (!['ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.regionId) applications = applications.where('region_id', '=', actor.regionId);
    const rows = await applications.execute();
    const stateCounts: Record<string, number> = {};
    const trackCounts: Record<string, number> = {};
    for (const row of rows as Array<{ state: string; track: string }>) { stateCounts[row.state] = (stateCounts[row.state] ?? 0) + 1; trackCounts[row.track] = (trackCounts[row.track] ?? 0) + 1; }
    const byState = Object.entries(stateCounts).map(([state, count]) => ({ state, count }));
    const byTrack = Object.entries(trackCounts).map(([track, count]) => ({ track, count }));
    return response({ total: rows.length, byState, byTrack });
  }
  @Get('workload')
  async workload(@CurrentUser() actor: Actor) {
    let query: any = this.database.db.selectFrom('task_assignments').innerJoin('users', 'users.id', 'task_assignments.assignee_id').select(['users.id', 'users.full_name', 'users.role', 'task_assignments.status']);
    if (!['ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.regionId) query = query.where('users.region_id', '=', actor.regionId);
    const rows = await query.execute();
    const groups: Record<string, { userId: string; fullName: string; role: string; openTasks: number; completedTasks: number }> = {};
    for (const row of rows as Array<{ id: string; full_name: string; role: string; status: string }>) {
      const entry = groups[row.id] ?? { userId: row.id, fullName: row.full_name, role: row.role, openTasks: 0, completedTasks: 0 };
      if (row.status === 'OPEN') entry.openTasks += 1; else entry.completedTasks += 1;
      groups[row.id] = entry;
    }
    const staff = Object.values(groups);
    return response(staff);
  }
}
