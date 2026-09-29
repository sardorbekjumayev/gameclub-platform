import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

export const API_PREFIX = 'api/v1';

/** main.ts, e2e testlar va OpenAPI generatsiyasi uchun umumiy sozlama. */
export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);
  app.setGlobalPrefix(API_PREFIX);
  // Web/admin Next proxy va Nginx orqasida haqiqiy klient IP (rate limit, audit uchun)
  (app as NestExpressApplication).set('trust proxy', 'loopback');
  app.use(helmet());
  app.enableCors({ origin: config.get<string[]>('CORS_ORIGINS'), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
}

export function buildOpenApi(app: INestApplication) {
  const doc = new DocumentBuilder()
    .setTitle('Game Club Platform API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, doc);
}
