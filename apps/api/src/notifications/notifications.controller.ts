import { Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { Actor } from '../common/actor.js';
import { response } from '../common/http.js';
import { DatabaseService } from '../database/database.service.js';
@ApiTags('Notifications')
@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(private readonly database: DatabaseService) {}
  @Get() async list(@CurrentUser() actor: Actor) { return response(await this.database.db.selectFrom('notifications').selectAll().where((eb) => eb.or([eb('recipient_id', '=', actor.id), eb('recipient_role', '=', actor.role)])).orderBy('created_at', 'desc').limit(100).execute()); }
  @Patch(':id/read') async read(@CurrentUser() actor: Actor, @Param('id') id: string) { const row = await this.database.db.updateTable('notifications').set({ read: true }).where('id', '=', id).where('recipient_id', '=', actor.id).returningAll().executeTakeFirst(); return response(row ?? { id, alreadyRead: true }); }
}
