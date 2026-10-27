import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Actor } from '../common/actor.js';
import { DatabaseService } from '../database/database.service.js';

interface LoginResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
  user: Actor;
  requiresPasswordChange: boolean;
  requiresTotpSetup: boolean;
}

@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService) {}

  async login(email: string, password: string, totpCode?: string, requestInfo?: { ip?: string; userAgent?: string }): Promise<LoginResult> {
    const user = await this.database.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email.trim().toLowerCase())
      .executeTakeFirst();
    if (!user || !(await argon2.verify(user.password_hash, password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const privileged = user.role !== 'INSTITUTION';
    if (user.is_totp_enabled) {
      if (!totpCode || !user.totp_secret || !authenticator.check(totpCode, user.totp_secret)) {
        throw new UnauthorizedException('A valid time-based one-time password is required');
      }
    }

    const actor = this.toActor(user);
    const refresh = await this.createRefreshToken(user.id, requestInfo);
    return {
      accessToken: this.signAccessToken(actor),
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt.toISOString(),
      user: actor,
      requiresPasswordChange: user.first_login_must_change_pwd,
      requiresTotpSetup: privileged && !user.is_totp_enabled,
    };
  }

  async refresh(rawToken: string | undefined, requestInfo?: { ip?: string; userAgent?: string }): Promise<LoginResult> {
    if (!rawToken) throw new UnauthorizedException('Refresh token is missing');
    const tokens = await this.database.db
      .selectFrom('refresh_tokens')
      .innerJoin('users', 'users.id', 'refresh_tokens.user_id')
      .select([
        'refresh_tokens.id as token_id',
        'refresh_tokens.token_hash',
        'refresh_tokens.expires_at',
        'refresh_tokens.revoked_at',
        'users.id', 'users.email', 'users.full_name', 'users.role', 'users.institution_id', 'users.region_id',
        'users.first_login_must_change_pwd', 'users.is_totp_enabled',
      ])
      .where('refresh_tokens.revoked_at', 'is', null)
      .where('refresh_tokens.expires_at', '>', new Date())
      .orderBy('refresh_tokens.created_at', 'desc')
      .execute();
    const match = (await Promise.all(tokens.map(async (token) => ({ token, valid: await argon2.verify(token.token_hash, rawToken) })))).find((entry) => entry.valid);
    if (!match) throw new UnauthorizedException('Refresh token is invalid or has expired');

    const replacement = await this.database.db.transaction().execute(async (trx) => {
      const refreshed = await this.createRefreshToken(match.token.id, requestInfo, trx);
      await trx.updateTable('refresh_tokens').set({ revoked_at: new Date(), replaced_by_id: refreshed.id }).where('id', '=', match.token.token_id).execute();
      return refreshed;
    });
    const actor: Actor = {
      id: match.token.id,
      email: match.token.email,
      fullName: match.token.full_name,
      role: match.token.role,
      institutionId: match.token.institution_id ?? undefined,
      regionId: match.token.region_id ?? undefined,
    };
    return {
      accessToken: this.signAccessToken(actor),
      refreshToken: replacement.token,
      refreshExpiresAt: replacement.expiresAt.toISOString(),
      user: actor,
      requiresPasswordChange: match.token.first_login_must_change_pwd,
      requiresTotpSetup: actor.role !== 'INSTITUTION' && !match.token.is_totp_enabled,
    };
  }

  async logout(rawToken?: string): Promise<void> {
    if (!rawToken) return;
    const rows = await this.database.db.selectFrom('refresh_tokens').select(['id', 'token_hash']).where('revoked_at', 'is', null).execute();
    const matched = (await Promise.all(rows.map(async (row) => ({ row, valid: await argon2.verify(row.token_hash, rawToken) })))).find((entry) => entry.valid);
    if (matched) await this.database.db.updateTable('refresh_tokens').set({ revoked_at: new Date() }).where('id', '=', matched.row.id).execute();
  }

  async changePassword(actor: Actor, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.database.db.selectFrom('users').selectAll().where('id', '=', actor.id).executeTakeFirst();
    if (!user || !(await argon2.verify(user.password_hash, currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (await argon2.verify(user.password_hash, newPassword)) {
      throw new BadRequestException('New password must differ from the current password');
    }
    await this.database.db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ password_hash: await this.hashPassword(newPassword), first_login_must_change_pwd: false, updated_at: new Date() }).where('id', '=', actor.id).execute();
      await trx.updateTable('refresh_tokens').set({ revoked_at: new Date() }).where('user_id', '=', actor.id).where('revoked_at', 'is', null).execute();
    });
  }

  async beginTotpSetup(actor: Actor): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    if (actor.role === 'INSTITUTION') throw new ForbiddenException('TOTP setup is not required for institution accounts');
    const secret = authenticator.generateSecret();
    const issuer = process.env.TOTP_ISSUER || 'AICTE Approval Tower';
    const otpauthUrl = authenticator.keyuri(actor.email, issuer, secret);
    return { secret, otpauthUrl, qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl) };
  }

  async confirmTotpSetup(actor: Actor, secret: string, token: string): Promise<void> {
    if (actor.role === 'INSTITUTION') throw new ForbiddenException('TOTP setup is not required for institution accounts');
    if (!authenticator.check(token, secret)) throw new BadRequestException('The verification code is not valid');
    await this.database.db.updateTable('users').set({ totp_secret: secret, is_totp_enabled: true, updated_at: new Date() }).where('id', '=', actor.id).execute();
  }

  async createUser(input: { email: string; password: string; fullName: string; role: string; institutionId?: string; regionId?: string; phone?: string }) {
    const existing = await this.database.db.selectFrom('users').select('id').where('email', '=', input.email.toLowerCase()).executeTakeFirst();
    if (existing) throw new BadRequestException('A user with this email already exists');
    return this.database.db.insertInto('users').values({
      email: input.email.toLowerCase(), password_hash: await this.hashPassword(input.password), full_name: input.fullName,
      role: input.role, institution_id: input.institutionId ?? null, region_id: input.regionId ?? null, phone: input.phone ?? null,
    }).returning(['id', 'email', 'full_name', 'role', 'institution_id', 'region_id', 'first_login_must_change_pwd']).executeTakeFirstOrThrow();
  }

  private async createRefreshToken(userId: string, requestInfo?: { ip?: string; userAgent?: string }, executor = this.database.db) {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.durationToMs(process.env.JWT_REFRESH_EXPIRY || '7d'));
    const row = await executor.insertInto('refresh_tokens').values({
      user_id: userId, token_hash: await argon2.hash(token, { type: argon2.argon2id }), expires_at: expiresAt,
      ip_address: requestInfo?.ip ?? null, user_agent: requestInfo?.userAgent ?? null,
    }).returning('id').executeTakeFirstOrThrow();
    return { id: row.id, token, expiresAt };
  }

  private signAccessToken(actor: Actor): string {
    const options: SignOptions = { expiresIn: (process.env.JWT_ACCESS_EXPIRY || '15m') as SignOptions['expiresIn'] };
    return jwt.sign({ email: actor.email, role: actor.role, fullName: actor.fullName, institutionId: actor.institutionId, regionId: actor.regionId, tokenType: 'access' }, this.accessSecret(), { ...options, subject: actor.id });
  }

  private toActor(user: { id: string; email: string; full_name: string; role: string; institution_id: string | null; region_id: string | null }): Actor {
    return { id: user.id, email: user.email, fullName: user.full_name, role: user.role, institutionId: user.institution_id ?? undefined, regionId: user.region_id ?? undefined };
  }

  private async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: Number(process.env.ARGON2_MEMORY_COST || 65536), timeCost: Number(process.env.ARGON2_TIME_COST || 3) });
  }

  private durationToMs(value: string): number {
    const matched = /^(\d+)([mhd])$/.exec(value);
    if (!matched) return 7 * 24 * 60 * 60 * 1000;
    return Number(matched[1]) * ({ m: 60_000, h: 3_600_000, d: 86_400_000 }[matched[2] as 'm' | 'h' | 'd']);
  }

  private accessSecret(): string {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) throw new Error('JWT_ACCESS_SECRET must be configured with at least 32 characters');
    return secret;
  }
}
