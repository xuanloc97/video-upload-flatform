/**
 * GraphQL object/enum/input types (code-first via `@nestjs/graphql`).
 *
 * These mirror the schema sketch in the design ("Backend (NestJS GraphQL)") and the shared domain
 * types. Only the shapes needed to compile the whole schema are defined here; the resolvers for
 * everything except `uploadVideo` are minimal stubs in this task (Tasks 5–6 fill them in).
 */
import { Field, ID, Int, ObjectType, InputType, registerEnumType } from '@nestjs/graphql';
import { ProcessingStatus } from '@video-platform/shared';

// Expose the shared Processing_Status lifecycle enum to the GraphQL schema.
registerEnumType(ProcessingStatus, {
  name: 'ProcessingStatus',
  description: 'Processing lifecycle state of an uploaded video.',
});

@ObjectType()
export class RenditionModel {
  @Field(() => String, { description: '"2K" | "1080p" | "720p" | "480p"' })
  label!: string;

  @Field(() => String, { description: 'Backend file route for this rendition.' })
  url!: string;

  @Field(() => Int, { nullable: true })
  width?: number | null;

  @Field(() => Int, { nullable: true })
  height?: number | null;
}

@ObjectType()
export class VideoMetadataModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ProcessingStatus)
  status!: ProcessingStatus;

  @Field(() => [RenditionModel], { description: 'Empty unless COMPLETED.' })
  renditions!: RenditionModel[];

  @Field(() => String, { nullable: true, description: 'Null unless COMPLETED.' })
  thumbnailUrl?: string | null;
}

@ObjectType({ description: 'One uploaded video and its processing lifecycle.' })
export class UploadRecordModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  originalFilename!: string;

  @Field(() => Date)
  uploadedAt!: Date;

  @Field(() => ProcessingStatus)
  status!: ProcessingStatus;
}

@InputType()
export class RenditionInput {
  @Field(() => String)
  label!: string;

  @Field(() => String)
  path!: string;

  @Field(() => Int, { nullable: true })
  width?: number | null;

  @Field(() => Int, { nullable: true })
  height?: number | null;
}

@InputType()
export class ProcessingResultInput {
  @Field(() => ID)
  id!: string;

  @Field(() => ProcessingStatus, { description: 'PROCESSING | COMPLETED | FAILED' })
  status!: ProcessingStatus;

  @Field(() => [RenditionInput], { nullable: true })
  renditions?: RenditionInput[] | null;

  @Field(() => String, { nullable: true })
  thumbnailPath?: string | null;

  @Field(() => String, { nullable: true })
  error?: string | null;
}
