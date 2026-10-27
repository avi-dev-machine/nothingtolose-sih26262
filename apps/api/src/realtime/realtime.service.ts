import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export interface RealtimeEvent { type: string; applicationId: string; institutionId: string; regionId: string; data: Record<string, unknown>; timestamp: string; }

@Injectable()
export class RealtimeService {
  private readonly events = new EventEmitter();
  publish(event: RealtimeEvent) { this.events.emit('application', event); }
  on(listener: (event: RealtimeEvent) => void) { this.events.on('application', listener); return () => this.events.off('application', listener); }
}
