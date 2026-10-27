import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly connection = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  private readonly notifications = new Queue('notifications', { connection: this.connection });
  private readonly documentProcessing = new Queue('document-processing', { connection: this.connection });

  async publishOutbox(eventId: string): Promise<void> {
    try {
      await this.notifications.add('deliver-outbox-event', { eventId }, { jobId: `outbox:${eventId}`, removeOnComplete: 1000, removeOnFail: 5000 });
    } catch (error) {
      // The durable outbox scanner will retry it. A Redis outage must never roll back a regulatory transition.
      this.logger.warn(`Unable to publish outbox event ${eventId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async enqueueDocumentProcessing(documentId: string): Promise<void> {
    await this.documentProcessing.add('classify-document', { documentId }, { jobId: `document:${documentId}`, removeOnComplete: 1000, removeOnFail: 5000 });
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.notifications.close(), this.documentProcessing.close(), this.connection.quit()]);
  }
}
