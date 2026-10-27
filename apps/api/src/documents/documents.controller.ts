import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { Actor } from '../common/actor.js';
import { parseInput, response } from '../common/http.js';
import { CompleteDocumentSchema, DocumentsService, PresignDocumentSchema } from './documents.service.js';
import { DatabaseService } from '../database/database.service.js';

@ApiTags('Documents')
@Controller('api/v1')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly database: DatabaseService,
  ) {}

  @Post('documents/presign')
  async presign(@CurrentUser() actor: Actor, @Body() body: unknown) {
    return response(await this.documents.presign(actor, parseInput(PresignDocumentSchema, body)));
  }

  @Post('documents/complete')
  async complete(@CurrentUser() actor: Actor, @Body() body: unknown) {
    return response(await this.documents.complete(actor, parseInput(CompleteDocumentSchema, body)));
  }

  @Get('documents/:id/download')
  async download(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return response(await this.documents.download(actor, id));
  }

  @Get('applications/:applicationId/documents')
  async listByApplication(@CurrentUser() actor: Actor, @Param('applicationId') applicationId: string) {
    const docs = await this.database.db
      .selectFrom('documents')
      .selectAll()
      .where('application_id', '=', applicationId)
      .orderBy('created_at', 'desc')
      .execute();

    return response(docs);
  }
}
