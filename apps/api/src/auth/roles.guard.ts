import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@aicte/shared';
import { ROLES_KEY } from './auth.decorator.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed?.length) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user || !allowed.includes(request.user.role as UserRole)) {
      throw new ForbiddenException('Your role is not permitted to perform this action');
    }
    return true;
  }
}
