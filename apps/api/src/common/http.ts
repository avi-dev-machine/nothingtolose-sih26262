import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Request validation failed',
      issues: result.error.flatten(),
    });
  }
  return result.data;
}

export function response<T>(data: T, message?: string) {
  return { success: true, data, ...(message ? { message } : {}), timestamp: new Date().toISOString() };
}
