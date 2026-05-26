// cspell:words IHDR
export interface ImageMetadata {
  width: number | null;
  height: number | null;
}

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

export function isAllowedImageMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  return ALLOWED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
}

export function readImageMetadata(buffer: Buffer, mimeType: string): ImageMetadata {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/png") return readPng(buffer);
  if (normalized === "image/gif") return readGif(buffer);
  if (normalized === "image/webp") return readWebp(buffer);
  if (normalized === "image/jpeg" || normalized === "image/jpg") return readJpeg(buffer);
  return emptyMetadata();
}

function emptyMetadata(): ImageMetadata {
  return { width: null, height: null };
}

function readPng(buffer: Buffer): ImageMetadata {
  if (buffer.length < 24) return emptyMetadata();
  const signature = buffer.subarray(0, 8);
  if (!signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return emptyMetadata();
  }
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return emptyMetadata();
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readGif(buffer: Buffer): ImageMetadata {
  if (buffer.length < 10) return emptyMetadata();
  const header = buffer.toString("ascii", 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") return emptyMetadata();
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function readWebp(buffer: Buffer): ImageMetadata {
  if (buffer.length < 16) return emptyMetadata();
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return emptyMetadata();
  if (buffer.toString("ascii", 8, 12) !== "WEBP") return emptyMetadata();

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;

    if (chunkType === "VP8X" && dataOffset + 10 <= buffer.length) {
      return {
        width: buffer.readUIntLE(dataOffset + 4, 3) + 1,
        height: buffer.readUIntLE(dataOffset + 7, 3) + 1,
      };
    }

    if (chunkType === "VP8 " && dataOffset + 10 <= buffer.length) {
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }

    if (chunkType === "VP8L" && dataOffset + 5 <= buffer.length) {
      const bits = buffer.readUInt32LE(dataOffset + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }

    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  return emptyMetadata();
}

function readJpeg(buffer: Buffer): ImageMetadata {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return emptyMetadata();
  }

  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;

    if (isSofMarker(marker) && offset + 8 < buffer.length) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }

  return emptyMetadata();
}

function isSofMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}
