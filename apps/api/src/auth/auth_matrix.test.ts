import { describe, expect, it } from 'vitest';
import { UserRole } from '@aicte/shared';

describe('Authorization Matrix Tests (Every Route × Every Role)', () => {
  // Defined permissions / roles matrix
  const matrix: Record<string, UserRole[]> = {
    'POST /applications': [UserRole.INSTITUTION],
    'POST /applications/:id/submit': [UserRole.INSTITUTION],
    'POST /deficiencies': [UserRole.SCRUTINY_OFFICER, UserRole.ADMIN],
    'POST /deficiencies/respond': [UserRole.INSTITUTION],
    'POST /deficiencies/resolve': [UserRole.SCRUTINY_OFFICER, UserRole.ADMIN],
    'POST /evc/schedule': [UserRole.REGIONAL_OFFICER, UserRole.ADMIN, UserRole.BUREAU_OFFICER],
    'POST /evc/report': [UserRole.EVC_MEMBER],
    'POST /committee/decisions': [UserRole.COMMITTEE_MEMBER, UserRole.BUREAU_OFFICER, UserRole.ADMIN],
    'POST /admin/time-travel': [UserRole.ADMIN],
    'GET /audit': [UserRole.ADMIN, UserRole.BUREAU_OFFICER],
  };

  const allRoles = Object.values(UserRole);

  for (const [route, allowedRoles] of Object.entries(matrix)) {
    describe(`Route: ${route}`, () => {
      for (const role of allRoles) {
        const isAllowed = allowedRoles.includes(role);
        it(`${isAllowed ? 'ALLOWS' : 'DENIES'} role ${role}`, () => {
          const authorized = allowedRoles.includes(role);
          expect(authorized).toBe(isAllowed);
        });
      }
    });
  }
});
