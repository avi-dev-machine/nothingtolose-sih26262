import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { randomUUID } from 'node:crypto';

export interface ApiErrorResponse {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
  timestamp: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const requestId = (request.headers['x-request-id'] as string) || (request.id as string) || randomUUID();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
        code = this.httpStatusToCode(status);
      } else if (typeof res === 'object' && res !== null) {
        const errorObj = res as Record<string, unknown>;
        message = (errorObj.message as string) || exception.message;
        code = (errorObj.code as string) || (errorObj.error as string) || this.httpStatusToCode(status);
        details = errorObj.details ?? errorObj.issues ?? undefined;
      }
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      code = 'VALIDATION_ERROR';
      message = 'Request payload validation failed';
      details = exception.flatten();
    } else if (typeof exception === 'object' && exception !== null) {
      const err = exception as Record<string, unknown>;
      const pgCode = err.code as string;
      if (pgCode === '23505') {
        status = HttpStatus.CONFLICT;
        code = 'CONFLICT_DUPLICATE_KEY';
        message = (err.detail as string) || 'A resource with this identifier already exists';
      } else if (pgCode === '23P01') {
        status = HttpStatus.CONFLICT;
        code = 'CLOCK_INVARIANT_VIOLATION';
        message = 'Conflicting clock event: simultaneous open clocks are forbidden';
      } else if (pgCode === '23503') {
        status = HttpStatus.BAD_REQUEST;
        code = 'FOREIGN_KEY_VIOLATION';
        message = (err.detail as string) || 'Referenced entity does not exist';
      } else if (err.message && typeof err.message === 'string') {
        if (err.message.includes('expectedVersion') || err.message.includes('Version conflict')) {
          status = HttpStatus.CONFLICT;
          code = 'VERSION_CONFLICT';
          message = err.message;
        } else {
          message = err.message;
        }
      }
    }

    this.logger.error(`[${requestId}] ${request.method} ${request.url} -> ${status} ${code}: ${message}`);

    const errorPayload: ApiErrorResponse = {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      requestId,
      timestamp: new Date().toISOString(),
    };

    response.status(status).header('x-request-id', requestId).send(errorPayload);
  }

  private httpStatusToCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'UNPROCESSABLE_ENTITY';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMIT_EXCEEDED';
      default:
        return 'INTERNAL_SERVER_ERROR';
    }
  }
}
