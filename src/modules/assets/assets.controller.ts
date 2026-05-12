import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { UploadedFile } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { UploadAssetDto } from './dto/upload-asset.dto';
import { QueryAssetsDto } from './dto/query-assets.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('assets')
@Controller('assets')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '上传资产' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: '工作空间 ID' },
        file: { type: 'string', format: 'binary', description: '文件' },
      },
      required: ['workspaceId', 'file'],
    },
  })
  @ApiResponse({ status: 201, description: '上传成功' })
  @ApiResponse({ status: 400, description: '参数错误或文件过大' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async upload(
    @Body() dto: UploadAssetDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    return this.assetsService.upload(dto.workspaceId, file, user.userId);
  }

  @Get()
  @ApiOperation({ summary: '获取资产列表' })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 400, description: '缺少 workspaceId' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async findAll(@Query() queryDto: QueryAssetsDto, @CurrentUser() user: any) {
    return this.assetsService.findAll(queryDto, user.userId);
  }

  @Get(':assetId/file')
  @ApiOperation({ summary: '获取资产文件（下载/预览）' })
  @ApiParam({ name: 'assetId', description: '资产 ID' })
  @ApiResponse({ status: 200, description: '文件流' })
  @ApiResponse({ status: 404, description: '资产或文件不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async getFile(@Param('assetId') assetId: string, @CurrentUser() user: any) {
    const { stream, mimeType, filename } = await this.assetsService.getFileStream(
      assetId,
      user.userId,
    );
    return new StreamableFile(stream, {
      type: mimeType,
      disposition: `inline; filename="${encodeURIComponent(filename)}"`,
    });
  }

  @Delete(':assetId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除资产' })
  @ApiParam({ name: 'assetId', description: '资产 ID' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '资产不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async remove(@Param('assetId') assetId: string, @CurrentUser() user: any) {
    return this.assetsService.remove(assetId, user.userId);
  }
}
