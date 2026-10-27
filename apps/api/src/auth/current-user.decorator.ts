import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Actor } from '../common/actor.js';
import type { AuthenticatedRequest } from './auth.types.js';

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): Actor => {
  return context.switchToHttp().getRequest<AuthenticatedRequest>().user;
});
