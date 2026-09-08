import { join } from 'path';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { DynamicModule, Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { TerminusModule } from '@nestjs/terminus';
import {
  FileSystemStorage,
  MetadataStore,
  SqliteMetadataStore,
  Storage,
} from '@video-platform/shared';
import { METADATA_STORE, MP4_PROBE, STORAGE } from './storage.tokens';
import { FfprobeMp4Probe } from './ffprobe-mp4-probe';
import { FileController } from './files/file.controller';
import { HealthController } from './health/health.controller';
import { UploadsHealthIndicator } from './health/uploads.health';
import { UploadResolver } from './upload/upload.resolver';
import { UploadService } from './upload/upload.service';

/** Default base directory for the shared `/uploads` volume when `UPLOADS_DIR` is unset. */
export const DEFAULT_UPLOADS_DIR = '/uploads';

/** Providers for the infrastructure tokens, allowing tests to override them (see `forRoot`). */
export interface AppModuleOverrides {
  storage?: Storage;
  metadataStore?: MetadataStore;
  mp4Probe?: unknown;
}

/**
 * Root application module.
 *
 * `forRoot` builds the module with either production infrastructure (real FileSystemStorage on
 * `UPLOADS_DIR`, SqliteMetadataStore, ffprobe-backed probe) or test overrides (temp-dir Storage,
 * temp-SQLite MetadataStore, stub probe). Wiring through DI tokens keeps resolvers agnostic of which
 * implementation is in play (design "Shared Storage Interface" / "Metadata Persistence").
 */
@Module({})
export class AppModule {
  static forRoot(overrides: AppModuleOverrides = {}): DynamicModule {
    const uploadsDir = process.env.UPLOADS_DIR ?? DEFAULT_UPLOADS_DIR;

    return {
      module: AppModule,
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: join(process.cwd(), 'schema.gql'),
          sortSchema: true,
        }),
        TerminusModule,
      ],
      controllers: [FileController, HealthController],
      providers: [
        {
          provide: STORAGE,
          useFactory: (): Storage =>
            overrides.storage ?? new FileSystemStorage(uploadsDir),
        },
        {
          provide: METADATA_STORE,
          useFactory: (): MetadataStore => {
            if (overrides.metadataStore) {
              return overrides.metadataStore;
            }
            const store = new SqliteMetadataStore(join(uploadsDir, 'metadata.db'));
            store.init();
            return store;
          },
        },
        {
          provide: MP4_PROBE,
          useFactory: () => overrides.mp4Probe ?? new FfprobeMp4Probe(),
        },
        UploadService,
        UploadResolver,
        UploadsHealthIndicator,
      ],
    };
  }
}
