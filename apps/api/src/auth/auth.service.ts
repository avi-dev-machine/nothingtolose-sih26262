import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { decryptField, encryptField, hashToken } from '../common/crypto.js';
import type { Actor } from '../common/actor.js';
import { DatabaseService } from '../database/database.service.js';
import { ClockService } from '../clock/clock.service.js';

interface LoginResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
  user: Actor;
  requiresPasswordChange: boolean;
  requiresTotpSetup: boolean;
}

export interface SessionInfo {
  id: string;
  familyId: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly clock: ClockService,
  ) {}

  async login(
    email: string,
    password: string,
    totpCode?: string,
    requestInfo?: { ip?: string; userAgent?: string },
  ): Promise<LoginResult> {
    const user = await this.database.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email.trim().toLowerCase())
      .executeTakeFirst();

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const now = this.clock.now();

    // Check account lockout (5 failures -> 15 min lock)
    if (user.locked_until && new Date(user.locked_until) > now) {
      const waitMinutes = Math.ceil((new Date(user.locked_until).getTime() - now.getTime()) / 60000);
      throw new ForbiddenException(
        `Account is temporarily locked due to 5 consecutive failed login attempts. Try again in ${waitMinutes} minute(s).`,
      );
    }

    const passwordMatches = await argon2.verify(user.password_hash, password);
    if (!passwordMatches) {
      const newFailedCount = (user.failed_logins ?? 0) + 1;
      const lockedUntil = newFailedCount >= 5 ? new Date(now.getTime() + 15 * 60 * 1000) : null;
      await this.database.db
        .updateTable('users')
        .set({
          failed_logins: newFailedCount,
          locked_until: lockedUntil,
          updated_at: now,
        })
        .where('id', '=', user.id)
        .execute();

      throw new UnauthorizedException(
        newFailedCount >= 5
          ? 'Account is now locked for 15 minutes due to 5 failed attempts'
          : `Invalid email or password (${5 - newFailedCount} attempts remaining before lockout)`,
      );
    }

    // Reset failed logins on successful password verification
    if ((user.failed_logins ?? 0) > 0 || user.locked_until) {
      await this.database.db
        .updateTable('users')
        .set({ failed_logins: 0, locked_until: null, updated_at: now })
        .where('id', '=', user.id)
        .execute();
    }

    const privileged = user.role !== 'INSTITUTION';
    const isTotpEnabled = Boolean(user.totp_enabled || (user as any).is_totp_enabled);

    if (isTotpEnabled) {
      const secretEnc = user.totp_secret_enc || (user as any).totp_secret;
      if (!secretEnc) {
        throw new UnauthorizedException('TOTP is enabled but secret is missing');
      }
      let secret = secretEnc;
      try {
        secret = decryptField(secretEnc);
      } catch {
        // Plaintext fallback if not encrypted
        secret = secretEnc;
      }

      if (!totpCode || !authenticator.check(totpCode, secret)) {
        throw new UnauthorizedException('A valid 6-digit TOTP code is required');
      }
    }

    const actor = this.toActor(user);
    const refresh = await this.createRefreshToken(user.id, undefined, requestInfo);

    return {
      accessToken: this.signAccessToken(actor),
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt.toISOString(),
      user: actor,
      requiresPasswordChange: Boolean(user.must_change_password || (user as any).first_login_must_change_pwd),
      requiresTotpSetup: privileged && !isTotpEnabled,
    };
  }

  /**
   * Refresh token rotation with Token Family Reuse Detection.
   * If a revoked token is presented, the entire family is immediately revoked!
   */
  async refresh(rawToken: string | undefined, requestInfo?: { ip?: string; userAgent?: string }): Promise<LoginResult> {
    if (!rawToken) {
      throw new UnauthorizedException('Refresh token is missing');
    }

    const tokenHash = hashToken(rawToken);
    const stored = await this.database.db
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const now = this.clock.now();

    // TOKEN REUSE DETECTION: If this token was already revoked, revoke the ENTIRE family!
    if (stored.revoked_at !== null) {
      await this.database.db
        .updateTable('refresh_tokens')
        .set({ revoked_at: now })
        .where('family_id', '=', stored.family_id)
        .execute();

      throw new UnauthorizedException('Token reuse detected. All sessions in this token family have been revoked.');
    }

    // Check expiration
    if (new Date(stored.expires_at) <= now) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    const user = await this.database.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', stored.user_id)
      .executeTakeFirst();

    if (!user) {
      throw new UnauthorizedException('User account no longer exists');
    }

    // Rotate token inside transaction: revoke current, issue new within same family_id
    const replacement = await this.database.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('refresh_tokens')
        .set({ revoked_at: now })
        .where('id', '=', stored.id)
        .execute();

      return this.createRefreshToken(stored.user_id, stored.family_id, requestInfo, trx);
    });

    const actor = this.toActor(user);

    return {
      accessToken: this.signAccessToken(actor),
      refreshToken: replacement.token,
      refreshExpiresAt: replacement.expiresAt.toISOString(),
      user: actor,
      requiresPasswordChange: Boolean(user.must_change_password || (user as any).first_login_must_change_pwd),
      requiresTotpSetup: actor.role !== 'INSTITUTION' && !Boolean(user.totp_enabled || (user as any).is_totp_enabled),
    };
  }

  async logout(rawToken?: string): Promise<void> {
    if (!rawToken) return;
    const tokenHash = hashToken(rawToken);
    await this.database.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: this.clock.now() })
      .where('token_hash', '=', tokenHash)
      .execute();
  }

  async listSessions(actor: Actor): Promise<SessionInfo[]> {
    const rows = await this.database.db
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('user_id', '=', actor.id)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', this.clock.now())
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map((r) => ({
      id: r.id,
      familyId: r.family_id,
      userAgent: r.user_agent,
      ipAddress: r.ip ? String(r.ip) : null,
      createdAt: new Date(r.created_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
    }));
  }

  async revokeSession(actor: Actor, sessionId: string): Promise<void> {
    const result = await this.database.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: this.clock.now() })
      .where('id', '=', sessionId)
      .where('user_id', '=', actor.id)
      .execute();

    if (Number(result[0]?.numUpdatedRows ?? 0) === 0) {
      throw new BadRequestException('Session not found or already revoked');
    }
  }

  async revokeAllOtherSessions(actor: Actor, currentToken?: string): Promise<void> {
    let currentHash = '';
    if (currentToken) {
      currentHash = hashToken(currentToken);
    }

    await this.database.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: this.clock.now() })
      .where('user_id', '=', actor.id)
      .where('token_hash', '!=', currentHash)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async changePassword(actor: Actor, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.database.db.selectFrom('users').selectAll().where('id', '=', actor.id).executeTakeFirst();
    if (!user || !(await argon2.verify(user.password_hash, currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (await argon2.verify(user.password_hash, newPassword)) {
      throw new BadRequestException('New password must differ from current password');
    }

    const now = this.clock.now();
    await this.database.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({
          password_hash: await this.hashPassword(newPassword),
          must_change_password: false,
          first_login_must_change_pwd: false,
          updated_at: now,
        })
        .where('id', '=', actor.id)
        .execute();

      // Revoke all existing sessions
      await trx
        .updateTable('refresh_tokens')
        .set({ revoked_at: now })
        .where('user_id', '=', actor.id)
        .where('revoked_at', 'is', null)
        .execute();
    });
  }

  /**
   * Request password reset token: writes outbox event for sending reset email.
   */
  async requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
    const user = await this.database.db
      .selectFrom('users')
      .select(['id', 'email', 'full_name', 'password_hash'])
      .where('email', '=', email.trim().toLowerCase())
      .executeTakeFirst();

    if (!user) {
      // Don't leak user existence
      return { success: true, message: 'If this email exists in our system, a password reset link has been dispatched.' };
    }

    // Reset token: signed with a secret derived from user's password_hash so it automatically invalidates once password changes!
    const resetSecret = `${this.accessSecret()}:${user.password_hash}`;
    const token = jwt.sign({ sub: user.id, email: user.email, type: 'password_reset' }, resetSecret, { expiresIn: '1h' });

    // Store in outbox for asynchronous email dispatch
    await this.database.db.insertInto('outbox_events').values({
      topic: 'NOTIFICATION_EMAIL',
      aggregate_type: 'USER',
      aggregate_id: user.id,
      payload: {
        to: user.email,
        subject: 'AICTE Control Tower: Password Reset Request',
        template: 'PASSWORD_RESET',
        data: {
          fullName: user.full_name,
          resetToken: token,
          resetUrl: `${process.env.APP_URL || 'http://localhost:3000'}/auth/reset-password?token=${token}`,
        },
      },
    }).execute();

    return { success: true, message: 'If this email exists in our system, a password reset link has been dispatched.' };
  }

  async resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
    let unverified: any;
    try {
      unverified = jwt.decode(token);
    } catch {
      throw new BadRequestException('Invalid reset token format');
    }

    if (!unverified || !unverified.sub || unverified.type !== 'password_reset') {
      throw new BadRequestException('Invalid reset token');
    }

    const user = await this.database.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', unverified.sub)
      .executeTakeFirst();

    if (!user) {
      throw new BadRequestException('User does not exist');
    }

    const resetSecret = `${this.accessSecret()}:${user.password_hash}`;
    try {
      jwt.verify(token, resetSecret);
    } catch {
      throw new BadRequestException('Password reset token is invalid or has already been used');
    }

    const now = this.clock.now();
    await this.database.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({
          password_hash: await this.hashPassword(newPassword),
          must_change_password: false,
          first_login_must_change_pwd: false,
          updated_at: now,
        })
        .where('id', '=', user.id)
        .execute();

      // Revoke all sessions
      await trx
        .updateTable('refresh_tokens')
        .set({ revoked_at: now })
        .where('user_id', '=', user.id)
        .where('revoked_at', 'is', null)
        .execute();
    });
  }

  async beginTotpSetup(actor: Actor): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    const secret = authenticator.generateSecret();
    const issuer = process.env.TOTP_ISSUER || 'AICTE Control Tower';
    const otpauthUrl = authenticator.keyuri(actor.email, issuer, secret);
    return {
      secret,
      otpauthUrl,
      qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl),
    };
  }

  async confirmTotpSetup(actor: Actor, secret: string, token: string): Promise<void> {
    if (!authenticator.check(token, secret)) {
      throw new BadRequestException('The verification code is invalid');
    }

    const encryptedSecret = encryptField(secret);
    await this.database.db
      .updateTable('users')
      .set({
        totp_secret_enc: encryptedSecret,
        totp_enabled: true,
        is_totp_enabled: true,
        updated_at: this.clock.now(),
      })
      .where('id', '=', actor.id)
      .execute();
  }

  async createUser(input: {
    email: string;
    password: string;
    fullName: string;
    role: string;
    institutionId?: string;
    regionId?: string;
    phone?: string;
  }) {
    const existing = await this.database.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', input.email.toLowerCase())
      .executeTakeFirst();

    if (existing) throw new BadRequestException('A user with this email already exists');

    return this.database.db
      .insertInto('users')
      .values({
        email: input.email.toLowerCase(),
        password_hash: await this.hashPassword(input.password),
        full_name: input.fullName,
        role: input.role as any,
        institution_id: input.institutionId ?? null,
        region_id: input.regionId ?? null,
        phone: input.phone ?? null,
        first_login_must_change_pwd: true,
        must_change_password: true,
      })
      .returning(['id', 'email', 'full_name', 'role', 'institution_id', 'region_id', 'first_login_must_change_pwd'])
      .executeTakeFirstOrThrow();
  }

  private async createRefreshToken(
    userId: string,
    existingFamilyId?: string,
    requestInfo?: { ip?: string; userAgent?: string },
    executor = this.database.db,
  ) {
    const token = randomBytes(48).toString('base64url');
    const tokenHash = hashToken(token);
    const familyId = existingFamilyId || randomBytes(16).toString('hex');
    const expiresAt = new Date(this.clock.nowMs() + this.durationToMs(process.env.JWT_REFRESH_EXPIRY || '7d'));

    const row = await executor
      .insertInto('refresh_tokens')
      .values({
        user_id: userId,
        token_hash: tokenHash,
        family_id: familyId,
        expires_at: expiresAt,
        ip: requestInfo?.ip as any,
        user_agent: requestInfo?.userAgent ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return { id: row.id, token, familyId, expiresAt };
  }

  private signAccessToken(actor: Actor): string {
    const options: SignOptions = { expiresIn: (process.env.JWT_ACCESS_EXPIRY || '15m') as SignOptions['expiresIn'] };
    return jwt.sign(
      {
        email: actor.email,
        role: actor.role,
        fullName: actor.fullName,
        institutionId: actor.institutionId,
        regionId: actor.regionId,
        tokenType: 'access',
      },
      this.accessSecret(),
      { ...options, subject: actor.id },
    );
  }

  private toActor(user: { id: string; email: string; full_name: string; role: string; institution_id: string | null; region_id: string | null }): Actor {
    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      institutionId: user.institution_id ?? undefined,
      regionId: user.region_id ?? undefined,
    };
  }

  private async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: Number(process.env.ARGON2_MEMORY_COST || 65536),
      timeCost: Number(process.env.ARGON2_TIME_COST || 3),
    });
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
