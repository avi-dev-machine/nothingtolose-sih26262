import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { Actor } from '../common/actor.js';
import { IS_PUBLIC_KEY } from './auth.decorator.js';
import type { AuthenticatedRequest } from './auth.types.js';

interface AccessTokenPayload extends JwtPayload {
  sub: string;
  email: string;
  role: string;
  fullName: string;
  institutionId?: string;
  regionId?: string;
  tokenType: 'access';
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('A bearer access token is required');
    }

    try {
      const decoded = jwt.verify(header.slice(7), this.accessSecret()) as AccessTokenPayload;
      if (decoded.tokenType !== 'access' || !decoded.sub || !decoded.email || !decoded.role) {
        throw new Error('Invalid token payload');
      }
      request.user = {
        id: decoded.sub,
        email: decoded.email,
        fullName: decoded.fullName,
        role: decoded.role,
        institutionId: decoded.institutionId,
        regionId: decoded.regionId,
      } satisfies Actor;
      return true;
    } catch {
      throw new UnauthorizedException('Access token is invalid or has expired');
    }
  }

  private accessSecret(): string {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_ACCESS_SECRET must be configured with at least 32 characters');
    }
    return secret;
  }
}
