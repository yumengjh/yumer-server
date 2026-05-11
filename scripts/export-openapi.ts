import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { dump } from 'js-yaml';

async function exportOpenApi() {
  process.env.OPENAPI_EXPORT = 'true';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../src/app.module');
  const app = await NestFactory.create(AppModule, { logger: false });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('知识库 API')
    .setDescription('个人知识库系统 API 文档')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  const json = JSON.stringify(document, null, 2);
  const yaml = dump(document);

  const outputDirs = [
    join(process.cwd(), 'openapi'),
    join(process.cwd(), 'docs', 'website', 'public', 'openapi'),
  ];

  for (const dir of outputDirs) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'openapi.json'), json, 'utf8');
    writeFileSync(join(dir, 'openapi.yaml'), yaml, 'utf8');
  }

  await app.close();
  console.log('✅ OpenAPI 导出完成');
  console.log(' - openapi/openapi.json');
  console.log(' - openapi/openapi.yaml');
  console.log(' - docs/website/public/openapi/openapi.json');
  console.log(' - docs/website/public/openapi/openapi.yaml');
}

exportOpenApi().catch((error) => {
  console.error('❌ OpenAPI 导出失败:', error);
  process.exit(1);
});
