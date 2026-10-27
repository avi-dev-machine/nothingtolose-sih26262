import { Controller, Sse } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { Actor } from '../common/actor.js';
import { RealtimeService, type RealtimeEvent } from './realtime.service.js';

@ApiTags('Realtime')
@Controller('api/v1/realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Sse('sse')
  stream(@CurrentUser() actor: Actor): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const listener = (event: RealtimeEvent) => {
        const visible = actor.role === 'ADMIN' || actor.role === 'BUREAU_OFFICER' || actor.institutionId === event.institutionId || actor.regionId === event.regionId;
        if (visible) subscriber.next({ type: event.type, data: JSON.stringify(event) } as MessageEvent);
      };
      const unsubscribe = this.realtime.on(listener);
      return unsubscribe;
    });
  }
}
