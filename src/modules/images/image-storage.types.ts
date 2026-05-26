import { Readable } from "stream";

export const IMAGE_STORAGE = "IMAGE_STORAGE";

export type ImageStorageProvider = "local" | "s3";
export type RedirectStrategy = "public-url";

export interface SaveImageInput {
  imageId: string;
  workspaceId: string;
  originalFilename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface StoredImageDescriptor {
  storagePath: string;
  mimeType: string;
  filename: string;
}

export interface SaveImageResult {
  storageProvider: ImageStorageProvider;
  storagePath: string;
  url: string;
}

export interface StreamImageReadTarget {
  type: "stream";
  stream: Readable;
  mimeType: string;
  filename: string;
}

export interface RedirectImageReadTarget {
  type: "redirect";
  redirectStrategy: RedirectStrategy;
  url: string;
}

export type ImageReadTarget = StreamImageReadTarget | RedirectImageReadTarget;
