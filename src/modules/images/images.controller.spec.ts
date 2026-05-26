import { Readable } from "stream";
// cspell:words Streamable
import { StreamableFile } from "@nestjs/common";
import type { Response } from "express";
import { ImagesController } from "./images.controller";
import type { ImagesService } from "./images.service";
import type { ImageReadTarget } from "./image-storage.types";

describe("ImagesController", () => {
  const imagesService: jest.Mocked<
    Pick<ImagesService, "upload" | "getPublicFileReadTarget" | "getFileReadTarget">
  > = {
    upload: jest.fn(),
    getPublicFileReadTarget: jest.fn(),
    getFileReadTarget: jest.fn(),
  };

  let controller: ImagesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ImagesController(imagesService as unknown as ImagesService);
  });

  it("本地 stream 读取返回带 type/disposition 的 StreamableFile", async () => {
    const stream = Readable.from(Buffer.from("local-image"));
    const readTarget: ImageReadTarget = {
      type: "stream",
      stream,
      mimeType: "image/png",
      filename: "cover.png",
    };

    imagesService.getPublicFileReadTarget.mockResolvedValue(readTarget);

    const result = await controller.getPublicFile("img_local", createResponse());

    expect(imagesService.getPublicFileReadTarget).toHaveBeenCalledWith("img_local");
    expect(result).toBeInstanceOf(StreamableFile);
    expect((result as StreamableFile).getHeaders()).toEqual({
      type: "image/png",
      disposition: 'inline; filename="cover.png"',
      length: undefined,
    });
  });

  it("S3 redirect 读取返回 302，且不会误判成 404", async () => {
    const response = createResponse();
    const readTarget: ImageReadTarget = {
      type: "redirect",
      redirectStrategy: "public-url",
      url: "https://cdn.example.com/workspaces/ws_1/images/img_s3.png",
    };

    imagesService.getPublicFileReadTarget.mockResolvedValue(readTarget);

    const result = await controller.getFile("img_s3", response);

    expect(imagesService.getPublicFileReadTarget).toHaveBeenCalledWith("img_s3");
    expect(response.redirect).toHaveBeenCalledWith(302, readTarget.url);
    expect(result).toBeUndefined();
  });
});

function createResponse(): Response {
  return {
    redirect: jest.fn(),
  } as unknown as Response;
}
