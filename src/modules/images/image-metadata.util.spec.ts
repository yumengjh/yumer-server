import { readImageMetadata } from "./image-metadata.util";
// cspell:words IHDR

describe("readImageMetadata", () => {
  it("reads PNG dimensions from IHDR", () => {
    const buffer = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
    buffer.writeUInt32BE(13, 8);
    buffer.write("IHDR", 12, "ascii");
    buffer.writeUInt32BE(640, 16);
    buffer.writeUInt32BE(480, 20);

    expect(readImageMetadata(buffer, "image/png")).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("reads GIF dimensions from the logical screen descriptor", () => {
    const buffer = Buffer.alloc(10);
    buffer.write("GIF89a", 0, "ascii");
    buffer.writeUInt16LE(320, 6);
    buffer.writeUInt16LE(240, 8);

    expect(readImageMetadata(buffer, "image/gif")).toEqual({
      width: 320,
      height: 240,
    });
  });

  it("reads WebP VP8X dimensions", () => {
    const buffer = Buffer.alloc(30);
    buffer.write("RIFF", 0, "ascii");
    buffer.write("WEBP", 8, "ascii");
    buffer.write("VP8X", 12, "ascii");
    buffer.writeUInt32LE(10, 16);
    buffer.writeUIntLE(799, 24, 3);
    buffer.writeUIntLE(599, 27, 3);

    expect(readImageMetadata(buffer, "image/webp")).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("reads JPEG dimensions from SOF marker", () => {
    const buffer = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c,
      0x02, 0x58, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    ]);

    expect(readImageMetadata(buffer, "image/jpeg")).toEqual({
      width: 600,
      height: 300,
    });
  });

  it("returns null dimensions for unsupported image buffers", () => {
    expect(readImageMetadata(Buffer.from("not an image"), "text/plain")).toEqual({
      width: null,
      height: null,
    });
  });
});
