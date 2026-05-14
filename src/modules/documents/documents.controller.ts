import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiParam } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { MoveDocumentDto } from './dto/move-document.dto';
import { QueryDocumentsDto } from './dto/query-documents.dto';
import { QueryRevisionsDto } from './dto/query-revisions.dto';
import { DiffVersionsDto } from './dto/diff-versions.dto';
import { RevertVersionDto } from './dto/revert-version.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { CommitVersionDto } from './dto/commit-version.dto';
import { QueryContentDto } from './dto/query-content.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { SitePublic, isSitePublicAnonymousUserId } from '../../common/decorators/public.decorator';

@ApiTags('documents')
@Controller('documents')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AuditLog({ action: 'CREATE', resourceType: 'document' })
  @ApiOperation({ summary: '创建文档' })
  @ApiResponse({ status: 201, description: '创建成功' })
  @ApiResponse({ status: 400, description: '请求参数错误' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async create(@Body() createDocumentDto: CreateDocumentDto, @CurrentUser() user: any) {
    return this.documentsService.create(createDocumentDto, user.userId);
  }

  @Get()
  @SitePublic()
  @ApiOperation({ summary: '获取文档列表' })
  @ApiResponse({ status: 200, description: '获取成功' })
  async findAll(@Query() queryDto: QueryDocumentsDto, @CurrentUser() user: any) {
    if (isSitePublicAnonymousUserId(user?.userId)) {
      return this.documentsService.findAllSitePublic(queryDto);
    }
    return this.documentsService.findAll(queryDto, user.userId);
  }

  @Get('search')
  @ApiOperation({ summary: '搜索文档' })
  @ApiResponse({ status: 200, description: '搜索成功' })
  async search(@Query() searchQueryDto: SearchQueryDto, @CurrentUser() user: any) {
    return this.documentsService.search(searchQueryDto, user.userId);
  }

  @Get(':docId')
  @SitePublic()
  @ApiOperation({ summary: '获取文档详情' })
  @ApiParam({ name: 'docId', description: '文档ID' })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 404, description: '文档不存在' })
  @ApiResponse({ status: 403, description: '没有权限访问' })
  async findOne(@Param('docId') docId: string, @CurrentUser() user: any) {
    if (isSitePublicAnonymousUserId(user?.userId)) {
      return this.documentsService.findOneSitePublic(docId);
    }
    return this.documentsService.findOne(docId, user.userId);
  }

  @Get(':docId/content')
  @SitePublic()
  @ApiOperation({ summary: '获取文档内容（渲染树，支持分页）' })
  @ApiParam({ name: 'docId', description: '文档ID' })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 404, description: '文档不存在' })
  async getContent(
    @Param('docId') docId: string,
    @Query() queryDto: QueryContentDto,
    @CurrentUser() user: any,
  ) {
    if (isSitePublicAnonymousUserId(user?.userId)) {
      return this.documentsService.getContentSitePublic(
        docId,
        queryDto.version,
        queryDto.maxDepth,
        queryDto.startBlockId,
        queryDto.limit,
      );
    }
    return this.documentsService.getContent(
      docId,
      queryDto.version,
      user.userId,
      queryDto.maxDepth,
      queryDto.startBlockId,
      queryDto.limit,
    );
  }

  @Patch(':docId')
  @ApiOperation({ summary: '更新文档元数据' })
  @ApiParam({ name: 'docId', description: '文档ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 404, description: '文档不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async update(
    @Param('docId') docId: string,
    @Body() updateDocumentDto: UpdateDocumentDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.update(docId, updateDocumentDto, user.userId);
  }

  @Post(':docId/publish')
  @ApiOperation({ summary: '发布文档' })
  @ApiParam({ name: 'docId', description: '文档ID' })
  @ApiResponse({ status: 200, description: '发布成功' })
  @ApiResponse({ status: 404, description: '文档不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async publish(@Param('docId') docId: string, @CurrentUser() user: any) {
    return this.documentsService.publish(docId, user.userId);
  }

  @Post(':docId/move')
  @ApiOperation({ summary: '移动文档' })
  @ApiParam({ name: 'docId', description: '文档ID' })
  @ApiResponse({ status: 200, description: '移动成功' })
  @ApiResponse({ status: 404, description: '文档不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  @ApiResponse({ status: 400, description: '移动操作无效' })
  async move(
    @Param('docId') docId: string,
    @Body() moveDocumentDto: MoveDocumentDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.move(docId, moveDocumentDto, user.userId);
  }

  @Delete(':docId')
  @HttpCode(HttpStatus.OK)
  @AuditLog({ action: 'DELETE', resourceType: 'document', resourceIdKey: 'docId' })
  @ApiOperation({ summary: '删除文档' })
  @ApiParam({ name: 'docId', description: '文档ID' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '文档不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async remove(@Param('docId') docId: string, @CurrentUser() user: any) {
    return this.documentsService.remove(docId, user.userId);
  }

  @Get(':docId/revisions')
  @ApiOperation({ summary: '获取文档修订历史' })
  @ApiParam({ name: 'docId', description: '文档ID' })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 404, description: '文档不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async getRevisions(
    @Param('docId') docId: string,
    @Query() queryDto: QueryRevisionsDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.getRevisions(docId, queryDto, user.userId);
  }

  @Get(':docId/diff')
  @ApiOperation({ summary: '版本对比' })
  @ApiParam({ name: 'docId', description: '文档ID' })
  @ApiResponse({ status: 200, description: '对比结果' })
  @ApiResponse({ status: 400, description: '参数错误' })
  @ApiResponse({ status: 404, description: '文档或版本不存在' })
  async getDiff(
    @Param('docId') docId: string,
    @Query() queryDto: DiffVersionsDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.getDiff(docId, queryDto.fromVer, queryDto.toVer, user.userId);
  }

  @Post(':docId/revert')
  @ApiOperation({ summary: '回滚到指定版本' })
  @ApiParam({ name: 'docId', description: '文档ID' })
  @ApiResponse({ status: 200, description: '回滚成功' })
  @ApiResponse({ status: 400, description: '参数错误' })
  @ApiResponse({ status: 404, description: '文档或版本不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async revert(
    @Param('docId') docId: string,
    @Body() revertDto: RevertVersionDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.revert(docId, revertDto.version, user.userId);
  }

  @Post(':docId/snapshots')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建文档快照' })
  @ApiParam({ name: 'docId', description: '文档ID' })
  @ApiResponse({ status: 201, description: '创建成功' })
  @ApiResponse({ status: 404, description: '文档不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async createSnapshot(@Param('docId') docId: string, @CurrentUser() user: any) {
    return this.documentsService.createSnapshot(docId, user.userId);
  }

  @Post(':docId/commit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '手动触发创建文档版本' })
  @ApiParam({ name: 'docId', description: '文档ID' })
  @ApiResponse({ status: 200, description: '版本创建成功' })
  @ApiResponse({ status: 400, description: '没有待创建的版本' })
  @ApiResponse({ status: 404, description: '文档不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async commitVersion(
    @Param('docId') docId: string,
    @Body() commitDto: CommitVersionDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.commitVersion(docId, commitDto.message, user.userId);
  }

  @Get(':docId/pending-versions')
  @ApiOperation({ summary: '获取文档待创建版本的数量' })
  @ApiParam({ name: 'docId', description: '文档ID' })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 404, description: '文档不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async getPendingVersions(@Param('docId') docId: string, @CurrentUser() user: any) {
    return this.documentsService.getPendingVersions(docId, user.userId);
  }
}
