import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { IdempotencyService } from './idempotency.service.js';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotency: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const res = http.getResponse<FastifyReply>();

    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    if (!idempotencyKey || req.method === 'GET' || req.method === 'HEAD') {
      return next.handle();
    }

    const scopedKey = `${(req as any).user?.id || 'anon'}:${req.url}:${idempotencyKey}`;
    const cached = this.idempotency.get(scopedKey);

    if (cached === 'IN_PROGRESS') {
      throw new ConflictException({
        code: 'IDEMPOTENCY_IN_PROGRESS',
        message: 'An identical request with this Idempotency-Key is currently being processed',
      });
    }

    if (cached) {
      res.header('idempotent-replayed', 'true');
      res.status(cached.statusCode);
      return of(cached.response);
    }

    this.idempotency.setInProgress(scopedKey);

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          this.idempotency.setCompleted(scopedKey, res.statusCode || 200, responseBody);
        },
        error: () => {
          this.idempotency.delete(scopedKey);
        },
      }),
    );
  }
}
