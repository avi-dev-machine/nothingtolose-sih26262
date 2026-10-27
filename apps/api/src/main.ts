import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function bootstrap() {
  const adapter = new FastifyAdapter({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
    requestIdHeader: 'x-request-id',
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  // Security headers equivalent to helmet
  adapter.getInstance().addHook('onSend', (req, reply, payload, done) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Content-Security-Policy', "default-src 'self'");
    done();
  });

  // Plugins
  await app.register(fastifyCookie as any, {
    secret: process.env.JWT_REFRESH_SECRET || 'aicte-refresh-secret-cookie-key',
  });

  await app.register(fastifyCors as any, {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:3000'],
    credentials: true,
  });

  // Global Exception Filter for uniform error shape: { code, message, details, requestId, timestamp }
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global Zod Validation
  app.useGlobalPipes(new ZodValidationPipe());

  // Swagger OpenAPI Documentation
  const config = new DocumentBuilder()
    .setTitle('AICTE Approval Control Tower API')
    .setDescription('Automated AICTE approval workflow, compliance monitoring and dual-clock SLA engine API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Export OpenAPI spec to packages/shared/openapi.json
  try {
    const sharedOpenApiPath = path.resolve(__dirname, '../../../packages/shared/openapi.json');
    fs.writeFileSync(sharedOpenApiPath, JSON.stringify(document, null, 2), 'utf-8');
    console.log(`[AICTE API] Exported OpenAPI specification to ${sharedOpenApiPath}`);
  } catch (err) {
    console.warn('[AICTE API] Notice: Could not write packages/shared/openapi.json:', err);
  }

  const port = Number(process.env.API_PORT) || 4000;
  const host = process.env.API_HOST || '0.0.0.0';

  await app.listen(port, host);
  console.log(`[AICTE API] Control Tower API is running on http://${host}:${port}`);
  console.log(`[AICTE API] Swagger documentation available at http://${host}:${port}/api/docs`);
}

bootstrap();
