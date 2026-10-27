import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../database/database.service.js';
import { PERMISSIONS_KEY } from './permissions.decorator.js';
import type { Actor } from '../common/actor.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private rolePermissionsCache = new Map<string, Set<string>>();
  private cacheExpiresAt = 0;

  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const actor: Actor | undefined = request.user;
    if (!actor) {
      throw new ForbiddenException('User is not authenticated');
    }

    // ADMIN has all permissions
    if (actor.role === 'ADMIN') {
      return true;
    }

    const permissions = await this.getPermissionsForRole(actor.role);
    const hasAll = required.every((perm) => permissions.has(perm));

    if (!hasAll) {
      throw new ForbiddenException(`Missing required permission: ${required.filter((p) => !permissions.has(p)).join(', ')}`);
    }

    return true;
  }

  private async getPermissionsForRole(role: string): Promise<Set<string>> {
    const now = Date.now();
    if (now > this.cacheExpiresAt || this.rolePermissionsCache.size === 0) {
      const rows = await this.database.db.selectFrom('role_permissions').selectAll().execute();
      this.rolePermissionsCache.clear();
      for (const row of rows) {
        if (!this.rolePermissionsCache.has(row.role)) {
          this.rolePermissionsCache.set(row.role, new Set());
        }
        this.rolePermissionsCache.get(row.role)!.add(row.permission_key);
      }
      this.cacheExpiresAt = now + 60_000; // cache for 1 minute
    }

    return this.rolePermissionsCache.get(role) ?? new Set();
  }
}
