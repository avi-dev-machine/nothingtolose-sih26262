import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { Actor } from '../common/actor.js';
import { parseInput, response } from '../common/http.js';
import { CompleteDocumentSchema, DocumentsService, PresignDocumentSchema } from './documents.service.js';
@ApiTags('Documents')
@Controller('api/v1/documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}
  @Post('presign') async presign(@CurrentUser() actor: Actor, @Body() body: unknown) { return response(await this.documents.presign(actor, parseInput(PresignDocumentSchema, body))); }
  @Post('complete') async complete(@CurrentUser() actor: Actor, @Body() body: unknown) { return response(await this.documents.complete(actor, parseInput(CompleteDocumentSchema, body))); }
  @Get(':id/download') async download(@CurrentUser() actor: Actor, @Param('id') id: string) { return response(await this.documents.download(actor, id)); }
}
