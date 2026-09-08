import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { graphqlUploadExpress } from 'graphql-upload-minimal';
import { AppModule } from './app.module';

/**
 * Backend entrypoint. Boots the NestJS + Apollo GraphQL application and installs the
 * `graphql-upload` Express middleware so multipart file uploads are parsed into the `Upload`
 * scalar before reaching the resolver (design "Backend (NestJS GraphQL)").
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule.forRoot());
  // Parse multipart requests; the streaming write path (UploadService) reads from these streams so
  // large (4K) files are never buffered in memory.
  app.use(graphqlUploadExpress({ maxFileSize: 10 * 1024 * 1024 * 1024, maxFiles: 1 }));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

// Only bootstrap when run directly, not when imported by tests.
if (require.main === module) {
  void bootstrap();
}

export { AppModule };
