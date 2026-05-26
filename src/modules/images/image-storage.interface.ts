import {
  ImageReadTarget,
  SaveImageInput,
  SaveImageResult,
  StoredImageDescriptor,
} from "./image-storage.types";

export interface ImageStorage {
  saveImage(input: SaveImageInput): Promise<SaveImageResult>;
  deleteImage(image: StoredImageDescriptor): Promise<void>;
  resolveReadTarget(image: StoredImageDescriptor): Promise<ImageReadTarget>;
}
