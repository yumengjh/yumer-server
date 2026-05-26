import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  // cspell:words Streamable
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { SitePublic } from "../../common/decorators/public.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ImagesService } from "./images.service";
import type { ImageReadTarget } from "./image-storage.types";

interface CurrentUserPayload {
  userId: string;
}

@ApiTags("images")
@Controller()
@UseGuards(JwtAuthGuard)
export class ImagesController {
  constructor(private readonly imagesService: ImagesService) {}

  @Post("images/upload")
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor("file"))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "上传图片" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "工作空间 ID" },
        file: { type: "string", format: "binary", description: "图片文件" },
      },
      required: ["workspaceId", "file"],
    },
  })
  async upload(
    @Body("workspaceId") workspaceId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.imagesService.upload(workspaceId, file, user.userId);
  }

  @Get("images/:imageId/file")
  @SitePublic()
  @ApiOperation({ summary: "读取图片文件" })
  async getFile(@Param("imageId") imageId: string, @Res({ passthrough: true }) res: Response) {
    const target = await this.imagesService.getPublicFileReadTarget(imageId);
    return this.respondWithReadTarget(target, res);
  }

  @Get("public/images/:imageId/file")
  @SitePublic()
  @ApiOperation({ summary: "公开读取图片文件" })
  async getPublicFile(
    @Param("imageId") imageId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const target = await this.imagesService.getPublicFileReadTarget(imageId);
    return this.respondWithReadTarget(target, res);
  }

  private respondWithReadTarget(target: ImageReadTarget, res: Response) {
    if (target.type === "redirect") {
      res.redirect(HttpStatus.FOUND, target.url);
      return;
    }

    return new StreamableFile(target.stream, {
      type: target.mimeType,
      disposition: `inline; filename="${encodeURIComponent(target.filename)}"`,
    });
  }
}
