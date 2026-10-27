import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const adapter = new FastifyAdapter({ logger: true });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  // Plugins
  await app.register(fastifyCookie as any, {
    secret: process.env.JWT_REFRESH_SECRET || 'aicte-refresh-secret-cookie-key',
  });

  await app.register(fastifyCors as any, {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  });

  // Global Zod Validation
  app.useGlobalPipes(new ZodValidationPipe());

  // Swagger OpenAPI Documentation
  const config = new DocumentBuilder()
    .setTitle('AICTE Approval Control Tower API')
    .setDescription('Automated AICTE approval workflow, compliance monitoring and alert management API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.API_PORT) || 4000;
  const host = process.env.API_HOST || '0.0.0.0';

  await app.listen(port, host);
  console.log(`[AICTE API] Control Tower API is running on http://${host}:${port}`);
  console.log(`[AICTE API] Swagger documentation available at http://${host}:${port}/api/docs`);
}

bootstrap();
