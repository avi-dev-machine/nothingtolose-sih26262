import { Injectable } from '@nestjs/common';

export interface IdempotencyRecord {
  statusCode: number;
  response: unknown;
  headers?: Record<string, string>;
  createdAt: number;
}

@Injectable()
export class IdempotencyService {
  private readonly store = new Map<string, IdempotencyRecord | 'IN_PROGRESS'>();
  private readonly ttlMs = 24 * 60 * 60 * 1000; // 24 hours

  get(key: string): IdempotencyRecord | 'IN_PROGRESS' | undefined {
    const item = this.store.get(key);
    if (!item) return undefined;
    if (item !== 'IN_PROGRESS' && Date.now() - item.createdAt > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return item;
  }

  setInProgress(key: string): void {
    this.store.set(key, 'IN_PROGRESS');
  }

  setCompleted(key: string, statusCode: number, response: unknown, headers?: Record<string, string>): void {
    this.store.set(key, {
      statusCode,
      response,
      headers,
      createdAt: Date.now(),
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}
