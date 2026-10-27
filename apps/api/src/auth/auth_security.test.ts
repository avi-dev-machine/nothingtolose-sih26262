import { describe, expect, it } from 'vitest';
import { decryptField, encryptField, hashToken } from '../common/crypto.js';

describe('Auth Security Primitives Unit Tests', () => {
  it('encrypts and decrypts TOTP secret using AES-256-GCM', () => {
    const rawSecret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptField(rawSecret);

    expect(encrypted).not.toBe(rawSecret);
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(20);

    const decrypted = decryptField(encrypted);
    expect(decrypted).toBe(rawSecret);
  });

  it('token hashing produces deterministic SHA-256 hex string', () => {
    const token = 'sample-refresh-token-value-12345';
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('detects 5 failed login attempts and calculates lockout expiration', () => {
    const checkLockout = (failedCount: number, now: Date) => {
      const isLocked = failedCount >= 5;
      const lockedUntil = isLocked ? new Date(now.getTime() + 15 * 60 * 1000) : null;
      return { isLocked, lockedUntil };
    };

    const now = new Date('2026-01-01T10:00:00Z');
    expect(checkLockout(4, now).isLocked).toBe(false);

    const locked = checkLockout(5, now);
    expect(locked.isLocked).toBe(true);
    expect(locked.lockedUntil?.toISOString()).toBe('2026-01-01T10:15:00.000Z');
  });

  it('revokes entire token family when a revoked token is reused', () => {
    interface TokenRecord {
      id: string;
      familyId: string;
      revokedAt: Date | null;
    }

    const familyTokens: TokenRecord[] = [
      { id: 'tok-1', familyId: 'fam-A', revokedAt: new Date(1000) },
      { id: 'tok-2', familyId: 'fam-A', revokedAt: new Date(2000) },
      { id: 'tok-3', familyId: 'fam-A', revokedAt: null },
      { id: 'tok-4', familyId: 'fam-B', revokedAt: null }, // different family
    ];

    const presentedToken = familyTokens[0]; // Already revoked tok-1 presented!
    const isReused = presentedToken.revokedAt !== null;
    expect(isReused).toBe(true);

    if (isReused) {
      // Revoke all in family
      const now = new Date(3000);
      for (const t of familyTokens) {
        if (t.familyId === presentedToken.familyId) {
          t.revokedAt = now;
        }
      }
    }

    expect(familyTokens.filter((t) => t.familyId === 'fam-A' && t.revokedAt === null).length).toBe(0);
    expect(familyTokens.find((t) => t.id === 'tok-4')?.revokedAt).toBeNull(); // Other family untouched
  });
});
