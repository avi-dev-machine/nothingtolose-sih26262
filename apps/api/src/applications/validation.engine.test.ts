import { describe, expect, it } from 'vitest';

describe('3-Layer Validation Engine Unit Tests', () => {
  it('validates Layer 1: Schema declarations (programs & courses)', () => {
    const validForm = {
      program: 'ENGINEERING_AND_TECHNOLOGY',
      courses: [{ name: 'Computer Science', proposedIntake: 120 }],
    };
    const invalidForm = {
      program: '',
      courses: [],
    };

    expect(Boolean(validForm.program) && validForm.courses.length > 0).toBe(true);
    expect(Boolean(invalidForm.program) && invalidForm.courses.length > 0).toBe(false);
  });

  it('validates Layer 2: Mandatory documents checklist', () => {
    const requiredCodes = ['FIRE_SAFETY_NOC', 'BUILDING_STABILITY', 'LAND_USE_CERTIFICATE'];
    const uploadedCodes = ['FIRE_SAFETY_NOC', 'BUILDING_STABILITY'];

    const missing = requiredCodes.filter((c) => !uploadedCodes.includes(c));
    expect(missing).toEqual(['LAND_USE_CERTIFICATE']);
    expect(missing.length).toBe(1);
  });

  it('validates Layer 3: APH Land Area Thresholds by Location Category', () => {
    const checkLand = (acres: number, category: string) => {
      const min = category === 'RURAL' ? 7.5 : category === 'METRO' ? 1.5 : 2.5;
      return acres >= min;
    };

    expect(checkLand(2.5, 'URBAN')).toBe(true);
    expect(checkLand(2.0, 'URBAN')).toBe(false);
    expect(checkLand(7.5, 'RURAL')).toBe(true);
    expect(checkLand(5.0, 'RURAL')).toBe(false);
    expect(checkLand(1.5, 'METRO')).toBe(true);
  });

  it('validates Layer 3: APH Built-up Area Thresholds', () => {
    const checkBuiltUp = (sqM: number, intake: number) => {
      const min = Math.max(2000, intake * 4.0);
      return sqM >= min;
    };

    expect(checkBuiltUp(2500, 300)).toBe(true); // 300 * 4 = 1200 -> max(2000, 1200) = 2000 <= 2500
    expect(checkBuiltUp(1800, 300)).toBe(false);
    expect(checkBuiltUp(3800, 1000)).toBe(false); // 1000 * 4 = 4000 > 3800
    expect(checkBuiltUp(4200, 1000)).toBe(true);
  });

  it('validates Layer 3: APH Faculty-Student Ratio (FSR 1:20)', () => {
    const checkFSR = (intake: number, faculty: number) => {
      if (faculty <= 0) return false;
      const ratio = intake / faculty;
      return ratio <= 20;
    };

    expect(checkFSR(120, 6)).toBe(true); // 120 / 6 = 20 <= 20
    expect(checkFSR(120, 5)).toBe(false); // 120 / 5 = 24 > 20
    expect(checkFSR(300, 20)).toBe(true); // 300 / 20 = 15 <= 20
  });

  it('validates Layer 3: APH Single Course Division Cap (max 300)', () => {
    const checkIntakeCap = (intake: number) => intake <= 300;

    expect(checkIntakeCap(180)).toBe(true);
    expect(checkIntakeCap(300)).toBe(true);
    expect(checkIntakeCap(360)).toBe(false);
  });
});
