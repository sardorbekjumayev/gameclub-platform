import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { buildOpenApi, configureApp } from '../src/bootstrap';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  const out = join(__dirname, '../../../packages/types/openapi.json');
  writeFileSync(out, JSON.stringify(buildOpenApi(app), null, 2));
  await app.close();
  console.log(`OpenAPI -> ${out}`);
}
main();
