import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@aicte/shared';
import type { Actor } from '../common/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class AiService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService) {}

  async delayRisk(actor: Actor, applicationId: string) {
    this.requireOfficer(actor);
    const app = await this.database.db.selectFrom('applications').innerJoin('institutions', 'institutions.id', 'applications.institution_id').selectAll('applications').select(['institutions.institution_type']).where('applications.id', '=', applicationId).executeTakeFirst();
    if (!app) throw new NotFoundException('Application not found');
    const [pending, stateStart] = await Promise.all([
      this.database.db.selectFrom('deficiencies').select((eb) => eb.fn.countAll<number>().as('count')).where('application_id', '=', applicationId).where('status', 'in', ['OPEN', 'RESPONDED']).executeTakeFirstOrThrow(),
      this.database.db.selectFrom('clock_events').select('timestamp').where('application_id', '=', applicationId).orderBy('timestamp', 'desc').executeTakeFirst(),
    ]);
    const payload = { application_id: app.id, current_state: app.state, days_in_current_state: Math.max(0, (Date.now() - new Date(stateStart?.timestamp ?? app.updated_at).getTime()) / 86_400_000), total_deficiencies_raised: Number(pending.count), deficiencies_pending: Number(pending.count), institution_type: app.institution_type, region_id: app.region_id };
    const result = await this.call('/predict/delay-risk', payload);
    return this.persistSuggestion(actor, applicationId, null, 'DELAY_RISK', result);
  }

  async aphQuery(actor: Actor, applicationId: string, query: string) {
    this.requireOfficer(actor);
    if (query.trim().length < 5) throw new BadRequestException('A meaningful APH query is required');
    const app = await this.database.db.selectFrom('applications').select(['id', 'academic_year']).where('id', '=', applicationId).executeTakeFirst();
    if (!app) throw new NotFoundException('Application not found');
    const result = await this.call('/aph/query', { query, top_k: 5, academic_year: app.academic_year });
    return this.persistSuggestion(actor, applicationId, null, 'APH_RAG', result);
  }

  async override(actor: Actor, suggestionId: string, reason: string) {
    this.requireOfficer(actor);
    if (reason.trim().length < 10) throw new BadRequestException('A clear human override reason is required');
    return this.database.db.transaction().execute(async (trx) => {
      const suggestion = await trx.selectFrom('ai_suggestions').selectAll().where('id', '=', suggestionId).forUpdate().executeTakeFirst();
      if (!suggestion) throw new NotFoundException('AI suggestion not found');
      if (suggestion.is_overridden) throw new BadRequestException('AI suggestion has already been overridden');
      const updated = await trx.updateTable('ai_suggestions').set({ is_overridden: true, overridden_by: actor.id, override_reason: reason }).where('id', '=', suggestionId).returningAll().executeTakeFirstOrThrow();
      await this.audit.append(trx, actor, { action: AuditAction.AI_SUGGESTION_OVERRIDDEN, targetEntity: 'APPLICATION', targetId: suggestion.application_id ?? actor.id, payload: { suggestionId, suggestionType: suggestion.suggestion_type, reason, humanOverride: true } });
      return updated;
    });
  }

  private async persistSuggestion(actor: Actor, applicationId: string, documentId: string | null, type: string, payload: unknown) {
    return this.database.db.transaction().execute(async (trx) => {
      const suggestion = await trx.insertInto('ai_suggestions').values({ application_id: applicationId, document_id: documentId, suggestion_type: type, model_name: 'aicte-ai-service', model_version: '1.0', confidence_score: this.confidence(payload), payload: { suggestionOnly: true, generatedAt: new Date().toISOString(), result: payload } }).returningAll().executeTakeFirstOrThrow();
      await this.audit.append(trx, actor, { action: AuditAction.AI_SUGGESTION_GENERATED, targetEntity: 'APPLICATION', targetId: applicationId, payload: { suggestionId: suggestion.id, suggestionType: type, confidenceScore: suggestion.confidence_score, isSuggestionOnly: true } });
      return { ...suggestion, disclaimer: 'AI-generated suggestion only. It cannot approve or reject an application and must be reviewed by an authorised human.' };
    });
  }

  private async call(path: string, payload: unknown): Promise<unknown> {
    try {
      const response = await fetch(`${process.env.AI_SERVICE_URL || 'http://localhost:8000'}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`AI service responded ${response.status}`);
      return await response.json();
    } catch (error) { throw new BadGatewayException(`AI service is unavailable: ${error instanceof Error ? error.message : String(error)}`); }
  }

  private confidence(payload: unknown): number { if (typeof payload === 'object' && payload) { const record = payload as Record<string, unknown>; const value = record.confidence ?? record.confidence_score; if (typeof value === 'number') return Math.max(0, Math.min(1, value > 1 ? value / 100 : value)); } return 0.5; }
  private requireOfficer(actor: Actor) { if (['INSTITUTION', 'EVC_MEMBER'].includes(actor.role)) throw new ForbiddenException('Only authorised officers may request AI assistance'); }
}
