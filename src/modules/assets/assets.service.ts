import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { createReadStream, existsSync } from 'fs';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { Asset } from '../../entities/asset.entity';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { generateAssetId } from '../../common/utils/id-generator.util';
import { QueryAssetsDto } from './dto/query-assets.dto';

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset)
    private assetRepository: Repository<Asset>,
    private configService: ConfigService,
    private workspacesService: WorkspacesService,
  ) {}

  private getUploadDir(): string {
    return this.configService.get<string>('app.uploadDir') || 'uploads';
  }

  private getMaxFileSize(): number {
    return this.configService.get<number>('app.maxFileSize') || 10 * 1024 * 1024;
  }

  private getApiPrefix(): string {
    return this.configService.get<string>('app.apiPrefix') || 'api/v1';
  }

  /**
   * 上传资产
   */
  async upload(workspaceId: string, file: Express.Multer.File, userId: string) {
    await this.workspacesService.checkAccess(workspaceId, userId);

    if (!file || !file.buffer) {
      throw new BadRequestException('请选择要上传的文件');
    }
    const maxSize = this.getMaxFileSize();
    if (file.size > maxSize) {
      throw new BadRequestException(`文件大小不能超过 ${Math.round(maxSize / 1024 / 1024)}MB`);
    }

    const assetId = generateAssetId();
    const uploadDir = this.getUploadDir();
    const sanitized = (file.originalname || 'file').replace(/[/\\]/g, '_');
    const filename = `${assetId}_${sanitized}`;
    const storagePath = join('workspaces', workspaceId, filename);
    const fullPath = join(process.cwd(), uploadDir, storagePath);

    // 创建目录（如果不存在）
    const workspaceDir = join(process.cwd(), uploadDir, 'workspaces', workspaceId);
    await mkdir(workspaceDir, {
      recursive: true,
    });

    // 保存文件
    try {
      await writeFile(fullPath, file.buffer);
      console.log(`文件已保存到: ${fullPath}`);
    } catch (error) {
      console.error(`文件保存失败: ${fullPath}`, error);
      throw new BadRequestException(`文件保存失败: ${error.message}`);
    }

    const apiPrefix = this.getApiPrefix();
    const url = `/${apiPrefix}/assets/${assetId}/file`;

    const asset = this.assetRepository.create({
      assetId,
      workspaceId,
      uploadedBy: userId,
      filename: file.originalname || 'file',
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      storageProvider: 'local',
      storagePath,
      url,
      status: 'active',
      refCount: 0,
      refs: [],
    });
    return await this.assetRepository.save(asset);
  }

  /**
   * 获取资产列表
   */
  async findAll(queryDto: QueryAssetsDto, userId: string) {
    const { workspaceId, page = 1, pageSize = 20 } = queryDto;
    if (!workspaceId) {
      throw new BadRequestException('workspaceId 为必填');
    }
    await this.workspacesService.checkAccess(workspaceId, userId);

    const skip = (page - 1) * pageSize;
    const [items, total] = await this.assetRepository.findAndCount({
      where: { workspaceId, status: 'active' },
      order: { createdAt: 'DESC' },
      skip,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  /**
   * 获取单条资产并检查权限（用于文件流或删除前校验）
   */
  async findOne(assetId: string, userId: string): Promise<Asset> {
    const asset = await this.assetRepository.findOne({
      where: { assetId },
    });
    if (!asset) {
      throw new NotFoundException('资产不存在');
    }
    await this.workspacesService.checkAccess(asset.workspaceId, userId);
    return asset;
  }

  /**
   * 获取资产文件流
   */
  async getFileStream(assetId: string, userId: string) {
    const asset = await this.findOne(assetId, userId);
    if (asset.status !== 'active') {
      throw new NotFoundException('资产不存在或已删除');
    }

    const uploadDir = this.getUploadDir();
    const fullPath = join(process.cwd(), uploadDir, asset.storagePath);

    if (!existsSync(fullPath)) {
      throw new NotFoundException('文件不存在');
    }

    return {
      stream: createReadStream(fullPath),
      mimeType: asset.mimeType,
      filename: asset.filename,
    };
  }

  /**
   * 删除资产（软删除，并尝试删除磁盘文件）
   */
  async remove(assetId: string, userId: string) {
    const asset = await this.findOne(assetId, userId);
    if (asset.status !== 'active') {
      throw new NotFoundException('资产不存在或已删除');
    }

    asset.status = 'deleted';
    await this.assetRepository.save(asset);

    const uploadDir = this.getUploadDir();
    const fullPath = join(process.cwd(), uploadDir, asset.storagePath);
    try {
      if (existsSync(fullPath)) {
        await unlink(fullPath);
      }
    } catch {
      // 忽略删除文件失败
    }
    return { message: '资产已删除' };
  }
}
