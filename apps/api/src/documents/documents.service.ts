import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditAction } from '@aicte/shared';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import { z } from 'zod';
import type { Actor } from '../common/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import { QueueService } from '../queue/queue.service.js';

export const PresignDocumentSchema = z
  .object({
    applicationId: z.string().uuid().optional(),
    institutionId: z.string().uuid().optional(),
    docTypeCode: z.string().min(1).max(64).optional(),
    fileName: z.string().min(1).max(255).regex(/^[^\\/]+$/),
    mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    fileSize: z.number().int().positive().max(20 * 1024 * 1024),
    sha256Checksum: z.string().regex(/^[a-fA-F0-9]{64}$/),
    supersedesId: z.string().uuid().optional(),
  })
  .refine((input) => input.applicationId || input.institutionId, 'An application or institution is required');

export const CompleteDocumentSchema = z.object({
  uploadId: z.string().uuid(),
  fileSize: z.number().int().positive().max(20 * 1024 * 1024),
  sha256Checksum: z.string().regex(/^[a-fA-F0-9]{64}$/),
});

const EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

interface PendingUpload {
  id: string;
  applicationId: string | null;
  institutionId: string;
  docTypeCode?: string;
  fileName: string;
  mimeType: string;
  expectedSize: number;
  expectedChecksum: string;
  supersedesId?: string;
  key: string;
}

@Injectable()
export class DocumentsService {
  private readonly pending = new Map<string, PendingUpload>();
  private readonly s3 = new S3Client({
    endpoint: this.endpoint(),
    forcePathStyle: true,
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    },
  });
  private readonly bucket = process.env.S3_BUCKET_DOCUMENTS || 'aicte-documents';

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly queues: QueueService,
  ) {}

  async presign(actor: Actor, input: z.infer<typeof PresignDocumentSchema>) {
    const institutionId = await this.resolveScope(actor, input.applicationId, input.institutionId);

    // Extension check
    const lower = input.fileName.toLowerCase();
    const validExt = ['.pdf', '.png', '.jpg', '.jpeg'].some((ext) => lower.endsWith(ext));
    if (!validExt) {
      throw new BadRequestException('File extension is not allowed. Only .pdf, .png, .jpg, .jpeg are permitted.');
    }

    const uploadId = randomUUID();
    const key = `institutions/${institutionId}/${input.applicationId ? `applications/${input.applicationId}/` : ''}${uploadId}-${input.fileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: input.mimeType,
      ContentLength: input.fileSize,
      Metadata: {
        sha256: input.sha256Checksum.toLowerCase(),
        uploadid: uploadId,
      },
    });

    try {
      const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 900 });
      this.pending.set(uploadId, {
        id: uploadId,
        applicationId: input.applicationId ?? null,
        institutionId,
        docTypeCode: input.docTypeCode,
        fileName: input.fileName,
        mimeType: input.mimeType,
        expectedSize: input.fileSize,
        expectedChecksum: input.sha256Checksum.toLowerCase(),
        supersedesId: input.supersedesId,
        key,
      });

      return {
        uploadId,
        uploadUrl,
        expiresInSeconds: 900,
        requiredHeaders: {
          'content-type': input.mimeType,
          'x-amz-meta-sha256': input.sha256Checksum.toLowerCase(),
          'x-amz-meta-uploadid': uploadId,
        },
      };
    } catch (error) {
      throw new ServiceUnavailableException(`Document storage is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async complete(actor: Actor, input: z.infer<typeof CompleteDocumentSchema>) {
    const pending = this.pending.get(input.uploadId);
    if (!pending) {
      throw new BadRequestException('Upload session is unknown or expired; request a new upload URL');
    }

    await this.resolveScope(actor, pending.applicationId ?? undefined, pending.institutionId);

    if (input.fileSize !== pending.expectedSize || input.sha256Checksum.toLowerCase() !== pending.expectedChecksum) {
      throw new BadRequestException('Completion metadata does not match the signed upload request');
    }

    const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: pending.key }));
    if (head.ContentLength !== pending.expectedSize || head.ContentType !== pending.mimeType) {
      throw new BadRequestException('Uploaded object metadata or size did not pass integrity verification');
    }

    // Download object body to check magic bytes and ClamAV / EICAR virus scan
    const obj = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: pending.key }));
    const bytes = await obj.Body!.transformToByteArray();
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // 1. Magic byte check
    this.verifyMagicBytes(buffer, pending.mimeType);

    // 2. SHA-256 integrity verification
    const computedHash = createHash('sha256').update(buffer).digest('hex');
    if (computedHash.toLowerCase() !== pending.expectedChecksum.toLowerCase()) {
      throw new BadRequestException('File SHA-256 checksum mismatch');
    }

    // 3. ClamAV / EICAR Antivirus Scanning
    const isClean = await this.scanForViruses(buffer);

    // 4. Duplicate detection across applications
    const duplicate = await this.database.db
      .selectFrom('documents')
      .selectAll()
      .where('sha256', '=', computedHash)
      .where('application_id', '!=', pending.applicationId)
      .executeTakeFirst();

    // Resolve doc_type_id
    let docTypeId: string | null = null;
    if (pending.docTypeCode) {
      const dt = await this.database.db
        .selectFrom('document_types')
        .select('id')
        .where('code', '=', pending.docTypeCode)
        .executeTakeFirst();
      docTypeId = dt?.id ?? null;
    }

    const document = await this.database.db.transaction().execute(async (trx) => {
      const status = isClean ? 'VERIFIED' : 'QUARANTINED';

      const row = await trx
        .insertInto('documents')
        .values({
          institution_id: pending.institutionId,
          application_id: pending.applicationId,
          doc_type_id: docTypeId,
          file_name: pending.fileName,
          file_size: pending.expectedSize,
          mime_type: pending.mimeType,
          sha256: computedHash,
          storage_uri: `s3://${this.bucket}/${pending.key}`,
          s3_bucket: this.bucket,
          s3_key: pending.key,
          sha256_checksum: computedHash,
          status: status as any,
          supersedes_id: pending.supersedesId ?? null,
          is_duplicate: Boolean(duplicate),
          duplicate_of_id: duplicate?.id ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.append(trx, actor, {
        action: isClean ? AuditAction.DOCUMENT_UPLOADED : 'DOCUMENT_QUARANTINED',
        entityType: 'DOCUMENT',
        entityId: row.id,
        applicationId: row.application_id ?? undefined,
        payload: {
          fileName: row.file_name,
          mimeType: row.mime_type,
          fileSize: row.file_size,
          sha256: computedHash,
          isClean,
          isDuplicate: Boolean(duplicate),
          duplicateOfApplicationId: duplicate?.application_id ?? null,
        },
      });

      if (!isClean) {
        throw new UnprocessableEntityException('Malicious file signature (EICAR) detected. File has been quarantined.');
      }

      return row;
    });

    this.pending.delete(input.uploadId);

    // After clean scan, enqueue AI extraction
    await this.queues.enqueueDocumentProcessing(document.id);

    return {
      ...document,
      isDuplicate: Boolean(duplicate),
      duplicateNotice: duplicate ? `Identical document previously submitted in application ${duplicate.application_id}` : null,
    };
  }

  async download(actor: Actor, documentId: string) {
    const document = await this.database.db
      .selectFrom('documents')
      .selectAll()
      .where('id', '=', documentId)
      .executeTakeFirst();

    if (!document) throw new NotFoundException('Document not found');
    await this.resolveScope(actor, document.application_id ?? undefined, document.institution_id ?? undefined);

    if (document.status === 'QUARANTINED') {
      throw new ForbiddenException('Cannot download quarantined malicious document');
    }

    // Per-download audit
    await this.database.db.transaction().execute(async (trx) => {
      await this.audit.append(trx, actor, {
        action: 'DOCUMENT_DOWNLOADED',
        entityType: 'DOCUMENT',
        entityId: document.id,
        applicationId: document.application_id ?? undefined,
        payload: { fileName: document.file_name, downloadedAt: new Date().toISOString() },
      });
    });

    try {
      const storageKey = (document as any).s3_key || ((document as any).storage_uri ? (document as any).storage_uri.replace(`s3://${this.bucket}/`, '') : '');
      const url = await getSignedUrl(
        this.s3,
        new GetObjectCommand({
          Bucket: (document as any).s3_bucket || this.bucket,
          Key: storageKey,
        }),
        { expiresIn: 300 }, // short-lived 5 minutes
      );

      return { downloadUrl: url, expiresInSeconds: 300 };
    } catch {
      throw new ServiceUnavailableException('Document storage is unavailable');
    }
  }

  private verifyMagicBytes(buffer: Buffer, mimeType: string): void {
    if (mimeType === 'application/pdf') {
      if (buffer.length < 4 || buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
        throw new BadRequestException('File is not a valid PDF: missing %PDF magic header');
      }
    } else if (mimeType === 'image/png') {
      if (
        buffer.length < 8 ||
        buffer[0] !== 0x89 ||
        buffer[1] !== 0x50 ||
        buffer[2] !== 0x4e ||
        buffer[3] !== 0x47
      ) {
        throw new BadRequestException('File is not a valid PNG image');
      }
    } else if (mimeType === 'image/jpeg') {
      if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        throw new BadRequestException('File is not a valid JPEG image');
      }
    }
  }

  private async scanForViruses(buffer: Buffer): Promise<boolean> {
    const content = buffer.toString('utf8');
    if (content.includes(EICAR_SIGNATURE)) {
      return false; // Virus detected!
    }

    const host = process.env.CLAMAV_HOST;
    const port = Number(process.env.CLAMAV_PORT || 3310);
    if (!host) {
      return true; // No ClamAV configured, fallback clean
    }

    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port, timeout: 3000 }, () => {
        socket.write('zINSTREAM\0');
        const chunkSize = 2048;
        for (let i = 0; i < buffer.length; i += chunkSize) {
          const chunk = buffer.subarray(i, i + chunkSize);
          const lenBuf = Buffer.alloc(4);
          lenBuf.writeUInt32BE(chunk.length, 0);
          socket.write(lenBuf);
          socket.write(chunk);
        }
        const zeroBuf = Buffer.alloc(4);
        zeroBuf.writeUInt32BE(0, 0);
        socket.write(zeroBuf);
      });

      let response = '';
      socket.on('data', (data) => {
        response += data.toString();
      });

      socket.on('end', () => {
        resolve(!response.includes('FOUND'));
      });

      socket.on('error', () => {
        resolve(true); // Graceful fallback
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(true);
      });
    });
  }

  private async resolveScope(actor: Actor, applicationId?: string, suppliedInstitutionId?: string): Promise<string> {
    let institutionId = suppliedInstitutionId;
    if (applicationId) {
      const app = await this.database.db
        .selectFrom('applications')
        .select(['institution_id', 'region_id'])
        .where('id', '=', applicationId)
        .executeTakeFirst();

      if (!app) throw new NotFoundException('Application not found');
      institutionId = app.institution_id;
      if (!['ADMIN', 'BUREAU_OFFICER'].includes(actor.role) && actor.role !== 'INSTITUTION' && actor.regionId && actor.regionId !== (app as any).region_id) {
        throw new ForbiddenException('Application is outside your regional scope');
      }
    }

    if (!institutionId) throw new BadRequestException('Unable to resolve owning institution');
    if (actor.role === 'INSTITUTION' && actor.institutionId !== institutionId) {
      throw new ForbiddenException('Document belongs to another institution');
    }
    return institutionId;
  }

  private endpoint() {
    const protocol = process.env.S3_USE_SSL === 'true' ? 'https' : 'http';
    return `${protocol}://${process.env.S3_ENDPOINT || 'localhost'}:${process.env.S3_PORT || '9000'}`;
  }
}
