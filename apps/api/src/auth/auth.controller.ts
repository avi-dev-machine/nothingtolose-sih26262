import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ChangePasswordSchema, LoginSchema, TotpVerifySchema } from '@aicte/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseInput, response } from '../common/http.js';
import type { Actor } from '../common/actor.js';
import { CurrentUser } from './current-user.decorator.js';
import { Public } from './auth.decorator.js';
import { AuthService } from './auth.service.js';

@ApiTags('Authentication')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = parseInput(LoginSchema, body);
    const result = await this.auth.login(input.email, input.password, input.totpCode, this.requestInfo(request));
    this.setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt);
    return response({ accessToken: result.accessToken, user: result.user, requiresPasswordChange: result.requiresPasswordChange, requiresTotpSetup: result.requiresTotpSetup });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.refresh(request.cookies?.refresh_token, this.requestInfo(request));
    this.setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt);
    return response({ accessToken: result.accessToken, user: result.user, requiresPasswordChange: result.requiresPasswordChange, requiresTotpSetup: result.requiresTotpSetup });
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(request.cookies?.refresh_token);
    reply.clearCookie('refresh_token', { path: '/api/v1/auth' });
  }

  @Get('me')
  me(@CurrentUser() actor: Actor) { return response(actor); }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const input = parseInput(ChangePasswordSchema, body);
    await this.auth.changePassword(actor, input.currentPassword, input.newPassword);
  }

  @Post('totp/setup')
  async setupTotp(@CurrentUser() actor: Actor) { return response(await this.auth.beginTotpSetup(actor)); }

  @Post('totp/confirm')
  @HttpCode(204)
  async confirmTotp(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const input = parseInput(TotpVerifySchema, body);
    if (!input.secret) throw new Error('TOTP setup secret is required');
    await this.auth.confirmTotpSetup(actor, input.secret, input.token);
  }

  private setRefreshCookie(reply: FastifyReply, token: string, expiresAt: string) {
    reply.setCookie('refresh_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1/auth', expires: new Date(expiresAt) });
  }

  private requestInfo(request: FastifyRequest) {
    return { ip: request.ip, userAgent: request.headers['user-agent'] };
  }
}
