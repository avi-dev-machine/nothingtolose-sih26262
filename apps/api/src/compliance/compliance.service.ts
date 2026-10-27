import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ComplianceStatus, type UpdateComplianceDto, CreateComplianceSchema } from '@aicte/shared';
import { z } from 'zod';
import type { Actor } from '../common/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class ComplianceService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService) {}

  async create(actor: Actor, input: z.input<typeof CreateComplianceSchema>) {
    if (!['INSTITUTION', 'REGIONAL_OFFICER', 'BUREAU_OFFICER', 'ADMIN'].includes(actor.role)) throw new ForbiddenException('You cannot register compliance records');
    const institution = await this.database.db.selectFrom('institutions').select(['id', 'region_id']).where('id', '=', input.institutionId).executeTakeFirst();
    if (!institution) throw new NotFoundException('Institution not found');
    this.assertScope(actor, institution.id, institution.region_id);
    const document = await this.database.db.selectFrom('documents').select(['id', 'institution_id']).where('id', '=', input.documentId).executeTakeFirst();
    if (!document || document.institution_id !== institution.id) throw new BadRequestException('Compliance document must belong to this institution');
    const alertBeforeDays = input.alertBeforeDays ?? 30;
    const status = this.computedStatus(new Date(input.expiryDate), alertBeforeDays);
    return this.database.db.transaction().execute(async (trx) => {
      const record = await trx.insertInto('compliance_records').values({ institution_id: input.institutionId, category: input.category, title: input.title, issuing_authority: input.issuingAuthority, reference_number: input.referenceNumber, issued_date: new Date(input.issuedDate), expiry_date: new Date(input.expiryDate), document_id: input.documentId, alert_before_days: alertBeforeDays, status }).returningAll().executeTakeFirstOrThrow();
      await this.audit.append(trx, actor, { action: AuditAction.COMPLIANCE_STATUS_UPDATED, targetEntity: 'COMPLIANCE_RECORD', targetId: record.id, payload: { status, expiryDate: input.expiryDate, category: input.category, title: input.title } });
      return record;
    });
  }

  async update(actor: Actor, id: string, input: UpdateComplianceDto) {
    const existing = await this.database.db.selectFrom('compliance_records').innerJoin('institutions', 'institutions.id', 'compliance_records.institution_id').selectAll('compliance_records').select('institutions.region_id').where('compliance_records.id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('Compliance record not found');
    this.assertScope(actor, existing.institution_id, existing.region_id);
    if (actor.role === 'INSTITUTION' && input.status && input.status !== ComplianceStatus.UNDER_RENEWAL) throw new ForbiddenException('Institutions may only mark an item under renewal');
    const expiryDate = input.expiryDate ? new Date(input.expiryDate) : existing.expiry_date;
    const status = input.status ?? this.computedStatus(expiryDate, existing.alert_before_days);
    return this.database.db.transaction().execute(async (trx) => {
      const row = await trx.updateTable('compliance_records').set({ status, expiry_date: expiryDate, renewal_document_id: input.renewalDocumentId ?? existing.renewal_document_id, remarks: input.remarks ?? existing.remarks, updated_at: new Date() }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await this.audit.append(trx, actor, { action: AuditAction.COMPLIANCE_STATUS_UPDATED, targetEntity: 'COMPLIANCE_RECORD', targetId: id, payload: { previousStatus: existing.status, status, expiryDate: expiryDate.toISOString(), renewalDocumentId: input.renewalDocumentId ?? null } });
      return row;
    });
  }

  async radar(actor: Actor, input: { regionId?: string; institutionId?: string; category?: string; status?: string; expiresInDays?: number }) {
    let query: any = this.database.db.selectFrom('compliance_records').innerJoin('institutions', 'institutions.id', 'compliance_records.institution_id').selectAll('compliance_records').select(['institutions.name as institution_name', 'institutions.region_id']);
    if (actor.role === 'INSTITUTION') query = query.where('compliance_records.institution_id', '=', actor.institutionId ?? '');
    else if (!['ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.regionId) query = query.where('institutions.region_id', '=', actor.regionId);
    if (input.regionId) query = query.where('institutions.region_id', '=', input.regionId);
    if (input.institutionId) query = query.where('compliance_records.institution_id', '=', input.institutionId);
    if (input.category) query = query.where('compliance_records.category', '=', input.category);
    if (input.status) query = query.where('compliance_records.status', '=', input.status);
    if (input.expiresInDays !== undefined) query = query.where('compliance_records.expiry_date', '<=', new Date(Date.now() + input.expiresInDays * 86_400_000));
    return query.orderBy('compliance_records.expiry_date', 'asc').execute();
  }

  private computedStatus(expiry: Date, beforeDays: number): ComplianceStatus { const days = (expiry.getTime() - Date.now()) / 86_400_000; return days < 0 ? ComplianceStatus.EXPIRED : days <= beforeDays ? ComplianceStatus.EXPIRING_SOON : ComplianceStatus.VALID; }
  private assertScope(actor: Actor, institutionId: string, regionId: string) { if (actor.role === 'INSTITUTION' && actor.institutionId !== institutionId) throw new ForbiddenException('Record belongs to another institution'); if (!['INSTITUTION', 'ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.regionId && actor.regionId !== regionId) throw new ForbiddenException('Institution is outside your regional scope'); }
}
