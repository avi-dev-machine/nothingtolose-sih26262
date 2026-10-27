import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

export interface ValidationItem {
  clauseNumber?: string;
  ruleKey: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  field?: string;
  expected?: string;
  actual?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationItem[];
  warnings: ValidationItem[];
  passed: ValidationItem[];
  allReports: ValidationItem[];
}

@Injectable()
export class ValidationEngineService {
  constructor(private readonly database: DatabaseService) {}

  async validateApplication(applicationId: string): Promise<ValidationResult> {
    const app = await this.database.db
      .selectFrom('applications')
      .selectAll()
      .where('id', '=', applicationId)
      .executeTakeFirst();

    if (!app) {
      throw new Error(`Application ${applicationId} not found`);
    }

    const latestForm = await this.database.db
      .selectFrom('application_forms')
      .selectAll()
      .where('application_id', '=', applicationId)
      .orderBy('version', 'desc')
      .executeTakeFirst();

    const formData = (latestForm?.data as Record<string, any>) || {};

    const reports: ValidationItem[] = [];

    // Layer 1: Schema Completeness
    this.validateSchemaFields(formData, reports);

    // Layer 2: Mandatory Documents
    await this.validateMandatoryDocuments(applicationId, app.track, app.type, reports);

    // Layer 3: APH Rule Engine (Land Area, Built-up Area, FSR, Intake)
    await this.evaluateAphRules(formData, reports);

    const errors = reports.filter((r) => r.status === 'FAIL');
    const warnings = reports.filter((r) => r.status === 'WARNING');
    const passed = reports.filter((r) => r.status === 'PASS');
    const valid = errors.length === 0;

    const result: ValidationResult = {
      valid,
      errors,
      warnings,
      passed,
      allReports: reports,
    };

    // Store in application_forms
    if (latestForm) {
      await this.database.db
        .updateTable('application_forms')
        .set({
          valid,
          validation_report: result as any,
        })
        .where('id', '=', latestForm.id)
        .execute();
    }

    return result;
  }

  private validateSchemaFields(data: Record<string, any>, reports: ValidationItem[]): void {
    if (!data.program || String(data.program).trim() === '') {
      reports.push({
        ruleKey: 'SCHEMA_PROGRAM_REQUIRED',
        name: 'Academic Program',
        field: 'program',
        status: 'FAIL',
        message: 'Academic Program is required in the application form',
      });
    } else {
      reports.push({
        ruleKey: 'SCHEMA_PROGRAM_REQUIRED',
        name: 'Academic Program',
        status: 'PASS',
        actual: String(data.program),
        message: 'Academic Program is specified',
      });
    }

    const courses = Array.isArray(data.courses) ? data.courses : [];
    if (courses.length === 0) {
      reports.push({
        ruleKey: 'SCHEMA_COURSES_REQUIRED',
        name: 'Course Details',
        field: 'courses',
        status: 'FAIL',
        message: 'At least one course with proposed intake must be declared',
      });
    } else {
      reports.push({
        ruleKey: 'SCHEMA_COURSES_REQUIRED',
        name: 'Course Details',
        status: 'PASS',
        actual: `${courses.length} course(s) declared`,
        message: 'Course declarations present',
      });
    }
  }

  private async validateMandatoryDocuments(
    applicationId: string,
    track: string,
    appType: string,
    reports: ValidationItem[],
  ): Promise<void> {
    const docTypes = await this.database.db.selectFrom('document_types').selectAll().execute();

    const uploadedDocs = await this.database.db
      .selectFrom('documents')
      .selectAll()
      .where('application_id', '=', applicationId)
      .where('status', 'not in', ['QUARANTINED', 'REJECTED'])
      .execute();

    const uploadedTypeIds = new Set(uploadedDocs.map((d) => (d as any).doc_type_id || (d as any).document_type_id));

    for (const dt of docTypes) {
      const requiredFor = Array.isArray(dt.required_for) ? (dt.required_for as string[]) : [];
      const isMandatory =
        requiredFor.includes('ALL') ||
        requiredFor.includes(track) ||
        requiredFor.includes(appType);

      if (!isMandatory) continue;

      const isUploaded = uploadedTypeIds.has(dt.id);
      if (isUploaded) {
        reports.push({
          ruleKey: `DOC_${dt.code}`,
          name: `Mandatory Document: ${dt.name}`,
          status: 'PASS',
          actual: 'Uploaded and verified',
          message: `${dt.name} (${dt.code}) is uploaded`,
        });
      } else {
        reports.push({
          ruleKey: `DOC_${dt.code}`,
          name: `Mandatory Document: ${dt.name}`,
          field: `documents.${dt.code}`,
          status: 'FAIL',
          expected: `Upload required for ${track}`,
          actual: 'Missing',
          message: `Mandatory document '${dt.name}' (${dt.code}) is required for submission`,
        });
      }
    }
  }

  private async evaluateAphRules(data: Record<string, any>, reports: ValidationItem[]): Promise<void> {
    const courses = Array.isArray(data.courses) ? data.courses : [];
    const totalIntake = courses.reduce((sum: number, c: any) => sum + (Number(c.proposedIntake) || 0), 0);
    const landArea = Number(data.landAreaAcres || data.land_area_acres || 0);
    const builtUpArea = Number(data.builtUpAreaSqM || data.built_up_area_sqm || 0);
    const facultyCount = Number(data.totalFacultyCount || data.faculty_count || 0);
    const locationCategory = String(data.locationCategory || 'URBAN').toUpperCase();

    // 1. Land Area Check
    const minLandRequired = locationCategory === 'RURAL' ? 7.5 : locationCategory === 'METRO' ? 1.5 : 2.5;
    if (landArea < minLandRequired) {
      reports.push({
        clauseNumber: 'APH-2024-C2.1',
        ruleKey: 'APH_MIN_LAND_AREA',
        name: 'APH Land Area Threshold',
        field: 'landAreaAcres',
        status: 'FAIL',
        expected: `>= ${minLandRequired} Acres (${locationCategory})`,
        actual: `${landArea} Acres`,
        message: `Land area ${landArea} acres is below the mandatory APH minimum of ${minLandRequired} acres for ${locationCategory} category`,
      });
    } else {
      reports.push({
        clauseNumber: 'APH-2024-C2.1',
        ruleKey: 'APH_MIN_LAND_AREA',
        name: 'APH Land Area Threshold',
        status: 'PASS',
        expected: `>= ${minLandRequired} Acres`,
        actual: `${landArea} Acres`,
        message: `Land area meets APH norms for ${locationCategory} area`,
      });
    }

    // 2. Built-up Area Check (min 4 sq meters per intake student or min 2000 sq meters)
    const minBuiltUp = Math.max(2000, totalIntake * 4.0);
    if (builtUpArea < minBuiltUp) {
      reports.push({
        clauseNumber: 'APH-2024-C2.3',
        ruleKey: 'APH_MIN_BUILT_UP_AREA',
        name: 'APH Built-up Area Norm',
        field: 'builtUpAreaSqM',
        status: 'FAIL',
        expected: `>= ${minBuiltUp} sq.m (${totalIntake} proposed intake)`,
        actual: `${builtUpArea} sq.m`,
        message: `Built-up area of ${builtUpArea} sq.m is insufficient for proposed intake of ${totalIntake} (minimum ${minBuiltUp} sq.m required)`,
      });
    } else {
      reports.push({
        clauseNumber: 'APH-2024-C2.3',
        ruleKey: 'APH_MIN_BUILT_UP_AREA',
        name: 'APH Built-up Area Norm',
        status: 'PASS',
        expected: `>= ${minBuiltUp} sq.m`,
        actual: `${builtUpArea} sq.m`,
        message: `Built-up area satisfies APH infrastructural guidelines`,
      });
    }

    // 3. Faculty-Student Ratio (FSR: 1:20 standard)
    if (totalIntake > 0) {
      const fsr = facultyCount > 0 ? totalIntake / facultyCount : Infinity;
      if (fsr > 20) {
        reports.push({
          clauseNumber: 'APH-2024-C3.1',
          ruleKey: 'APH_FACULTY_STUDENT_RATIO',
          name: 'Faculty-Student Ratio (FSR)',
          field: 'totalFacultyCount',
          status: 'FAIL',
          expected: 'Ratio <= 1:20 (FSR)',
          actual: `1:${fsr.toFixed(1)} (${facultyCount} faculty for ${totalIntake} intake)`,
          message: `Faculty to student intake ratio 1:${fsr.toFixed(1)} violates APH mandatory threshold of 1:20`,
        });
      } else {
        reports.push({
          clauseNumber: 'APH-2024-C3.1',
          ruleKey: 'APH_FACULTY_STUDENT_RATIO',
          name: 'Faculty-Student Ratio (FSR)',
          status: 'PASS',
          expected: '<= 1:20',
          actual: `1:${fsr.toFixed(1)}`,
          message: 'Faculty-to-student ratio satisfies APH norms',
        });
      }
    }

    // 4. Per-course Intake Cap (Max 300 students per branch)
    for (const c of courses) {
      const intake = Number(c.proposedIntake) || 0;
      if (intake > 300) {
        reports.push({
          clauseNumber: 'APH-2024-C1.4',
          ruleKey: 'APH_COURSE_INTAKE_CAP',
          name: `Intake Cap: ${c.name || 'Course'}`,
          field: 'courses.proposedIntake',
          status: 'FAIL',
          expected: '<= 300 seats',
          actual: `${intake} seats`,
          message: `Course ${c.name || ''} proposed intake ${intake} exceeds APH single course division cap of 300`,
        });
      }
    }
  }
}
