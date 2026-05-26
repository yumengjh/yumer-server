import type { ConfigService } from "@nestjs/config";
import { createImageMulterOptions, getMaxImageFileSize } from "./image-upload-limits.util";

const createConfigService = (values: Record<string, unknown>): ConfigService =>
  ({
    get: jest.fn((key: string) => values[key]),
  }) as unknown as ConfigService;

describe("image upload limits", () => {
  it("uses app.maxImageFileSize for both service validation and multer limits", () => {
    const configService = createConfigService({
      "app.maxImageFileSize": 32 * 1024 * 1024,
      "app.maxFileSize": 10 * 1024 * 1024,
    });

    expect(getMaxImageFileSize(configService)).toBe(32 * 1024 * 1024);
    expect(createImageMulterOptions(configService)).toEqual({
      limits: { fileSize: 32 * 1024 * 1024 },
    });
  });

  it("falls back to app.maxFileSize when image-specific config is absent", () => {
    const configService = createConfigService({
      "app.maxImageFileSize": undefined,
      "app.maxFileSize": 8 * 1024 * 1024,
    });

    expect(getMaxImageFileSize(configService)).toBe(8 * 1024 * 1024);
    expect(createImageMulterOptions(configService)).toEqual({
      limits: { fileSize: 8 * 1024 * 1024 },
    });
  });
});
