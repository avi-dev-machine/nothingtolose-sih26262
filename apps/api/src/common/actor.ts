import type { AuthenticatedUser } from '@aicte/shared';

export type Actor = AuthenticatedUser;

export function hasRegionalScope(actor: Actor, regionId: string): boolean {
  return actor.role === 'ADMIN' || actor.role === 'BUREAU_OFFICER' || actor.regionId === regionId;
}
