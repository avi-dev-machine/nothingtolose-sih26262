import { z } from 'zod';
import { UserRole } from '../enums/roles.enum.js';

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  totpCode: z.string().length(6, 'TOTP code must be 6 digits').optional(),
});

export type LoginDto = z.infer<typeof LoginSchema>;

export const RegisterUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  fullName: z.string().min(2, 'Full name required'),
  role: z.nativeEnum(UserRole),
  institutionId: z.string().uuid().optional(),
  regionId: z.string().uuid().optional(),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid Indian 10-digit mobile number').optional(),
});

export type RegisterUserDto = z.infer<typeof RegisterUserSchema>;

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token required'),
});

export type RefreshTokenDto = z.infer<typeof RefreshTokenSchema>;

export const TotpVerifySchema = z.object({
  token: z.string().length(6, '6-digit code required'),
  secret: z.string().optional(),
});

export type TotpVerifyDto = z.infer<typeof TotpVerifySchema>;

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, 'New password must be at least 12 characters'),
});

export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;
