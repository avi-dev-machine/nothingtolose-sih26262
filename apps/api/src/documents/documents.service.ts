import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AuditAction } from '@aicte/shared';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../common/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import { QueueService } from '../queue/queue.service.js';

export const PresignDocumentSchema = z.object({ applicationId: z.string().uuid().optional(), institutionId: z.string().uuid().optional(), fileName: z.string().min(1).max(255).regex(/^[^\\/]+$/), mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']), fileSize: z.number().int().positive().max(20 * 1024 * 1024), sha256Checksum: z.string().regex(/^[a-fA-F0-9]{64}$/) }).refine((input) => input.applicationId || input.institutionId, 'An application or institution is required');
export const CompleteDocumentSchema = z.object({ uploadId: z.string().uuid(), fileSize: z.number().int().positive().max(20 * 1024 * 1024), sha256Checksum: z.string().regex(/^[a-fA-F0-9]{64}$/) });

interface PendingUpload { id: string; applicationId: string | null; institutionId: string | null; fileName: string; mimeType: string; expectedSize: number; expectedChecksum: string; key: string; }

@Injectable()
export class DocumentsService {
  private readonly pending = new Map<string, PendingUpload>();
  private readonly s3 = new S3Client({ endpoint: this.endpoint(), forcePathStyle: true, region: process.env.S3_REGION || 'us-east-1', credentials: { accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin', secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin' } });
  private readonly bucket = process.env.S3_BUCKET_DOCUMENTS || 'aicte-documents';
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService, private readonly queues: QueueService) {}

  async presign(actor: Actor, input: z.infer<typeof PresignDocumentSchema>) {
    const institutionId = await this.resolveScope(actor, input.applicationId, input.institutionId);
    const uploadId = randomUUID();
    const key = `institutions/${institutionId}/${input.applicationId ? `applications/${input.applicationId}/` : ''}${uploadId}-${input.fileName}`;
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: input.mimeType, ContentLength: input.fileSize, Metadata: { sha256: input.sha256Checksum.toLowerCase(), uploadid: uploadId } });
    try {
      const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 900 });
      this.pending.set(uploadId, { id: uploadId, applicationId: input.applicationId ?? null, institutionId, fileName: input.fileName, mimeType: input.mimeType, expectedSize: input.fileSize, expectedChecksum: input.sha256Checksum.toLowerCase(), key });
      return { uploadId, uploadUrl, expiresInSeconds: 900, requiredHeaders: { 'content-type': input.mimeType, 'x-amz-meta-sha256': input.sha256Checksum.toLowerCase(), 'x-amz-meta-uploadid': uploadId } };
    } catch (error) {
      throw new ServiceUnavailableException(`Document storage is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async complete(actor: Actor, input: z.infer<typeof CompleteDocumentSchema>) {
    const pending = this.pending.get(input.uploadId);
    if (!pending) throw new BadRequestException('Upload session is unknown or expired; request a new upload URL');
    await this.resolveScope(actor, pending.applicationId ?? undefined, pending.institutionId ?? undefined);
    if (input.fileSize !== pending.expectedSize || input.sha256Checksum.toLowerCase() !== pending.expectedChecksum) throw new BadRequestException('Completion metadata does not match the signed upload request');
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: pending.key }));
      if (head.ContentLength !== pending.expectedSize || head.ContentType !== pending.mimeType || head.Metadata?.sha256 !== pending.expectedChecksum || head.Metadata?.uploadid !== pending.id) throw new BadRequestException('Uploaded object metadata or size did not pass integrity verification');
      const document = await this.database.db.transaction().execute(async (trx) => {
        const row = await trx.insertInto('documents').values({ institution_id: pending.institutionId, application_id: pending.applicationId, file_name: pending.fileName, file_size: pending.expectedSize, mime_type: pending.mimeType, s3_bucket: this.bucket, s3_key: pending.key, sha256_checksum: pending.expectedChecksum }).returningAll().executeTakeFirstOrThrow();
        await this.audit.append(trx, actor, { action: AuditAction.DOCUMENT_UPLOADED, targetEntity: 'DOCUMENT', targetId: row.id, payload: { fileName: row.file_name, mimeType: row.mime_type, fileSize: row.file_size, sha256Checksum: row.sha256_checksum, applicationId: row.application_id } });
        return row;
      });
      this.pending.delete(input.uploadId);
      await this.queues.enqueueDocumentProcessing(document.id);
      return document;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException(`Cannot verify uploaded object: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async download(actor: Actor, documentId: string) {
    const document = await this.database.db.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirst();
    if (!document) throw new NotFoundException('Document not found');
    await this.resolveScope(actor, document.application_id ?? undefined, document.institution_id ?? undefined);
    try { return { downloadUrl: await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: document.s3_bucket, Key: document.s3_key }), { expiresIn: 300 }), expiresInSeconds: 300 }; }
    catch { throw new ServiceUnavailableException('Document storage is unavailable'); }
  }

  private async resolveScope(actor: Actor, applicationId?: string, suppliedInstitutionId?: string): Promise<string> {
    let institutionId = suppliedInstitutionId;
    if (applicationId) {
      const app = await this.database.db.selectFrom('applications').select(['institution_id', 'region_id']).where('id', '=', applicationId).executeTakeFirst();
      if (!app) throw new NotFoundException('Application not found');
      institutionId = app.institution_id;
      if (!['ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.role !== 'INSTITUTION' && actor.regionId && actor.regionId !== app.region_id) throw new ForbiddenException('Application is outside your regional scope');
    }
    if (!institutionId) throw new BadRequestException('Unable to resolve owning institution');
    if (actor.role === 'INSTITUTION' && actor.institutionId !== institutionId) throw new ForbiddenException('Document belongs to another institution');
    return institutionId;
  }

  private endpoint() { const protocol = process.env.S3_USE_SSL === 'true' ? 'https' : 'http'; return `${protocol}://${process.env.S3_ENDPOINT || 'localhost'}:${process.env.S3_PORT || '9000'}`; }
}
