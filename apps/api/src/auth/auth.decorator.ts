import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@aicte/shared';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
