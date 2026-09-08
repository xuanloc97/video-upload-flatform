import { gql } from '@apollo/client';

/** Processing lifecycle states, mirroring the backend `ProcessingStatus` enum. */
export type ProcessingStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface UploadRecord {
  id: string;
  originalFilename: string;
  uploadedAt: string;
  status: ProcessingStatus;
}

export interface Rendition {
  label: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface VideoMetadata {
  id: string;
  status: ProcessingStatus;
  renditions: Rendition[];
  thumbnailUrl: string | null;
}

/** Mutation: upload an MP4 via the multipart `Upload` scalar; returns the new PENDING record. */
export const UPLOAD_VIDEO = gql`
  mutation UploadVideo($file: Upload!) {
    uploadVideo(file: $file) {
      id
      originalFilename
      uploadedAt
      status
    }
  }
`;

/** Query: list every upload with its current status (polled for live updates). */
export const LIST_VIDEOS = gql`
  query Videos {
    videos {
      id
      originalFilename
      uploadedAt
      status
    }
  }
`;

/** Query: rendition/thumbnail metadata (only populated once COMPLETED). */
export const VIDEO_METADATA = gql`
  query VideoMetadata($id: ID!) {
    videoMetadata(id: $id) {
      id
      status
      thumbnailUrl
      renditions {
        label
        url
        width
        height
      }
    }
  }
`;

export interface ListVideosData {
  videos: UploadRecord[];
}

export interface VideoMetadataData {
  videoMetadata: VideoMetadata;
}

export interface UploadVideoData {
  uploadVideo: UploadRecord;
}
