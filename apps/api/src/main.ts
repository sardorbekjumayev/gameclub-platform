import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { buildOpenApi, configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const config = app.get(ConfigService);
  if (config.get('NODE_ENV') !== 'production') {
    SwaggerModule.setup('api/docs', app, buildOpenApi(app));
  }
  await app.listen(config.get<number>('PORT')!);
}
bootstrap();
