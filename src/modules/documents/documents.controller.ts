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
  Res,
  StreamableFile,
} from "@nestjs/common";
import type { Response } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { DocumentsService, type ContentRenderDiagnostics } from "./documents.service";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { UpdateDocumentDto } from "./dto/update-document.dto";
import { MoveDocumentDto } from "./dto/move-document.dto";
import { QueryDocumentsDto } from "./dto/query-documents.dto";
import { QueryRevisionsDto } from "./dto/query-revisions.dto";
import { DiffVersionsDto } from "./dto/diff-versions.dto";
import { RevertVersionDto } from "./dto/revert-version.dto";
import { SearchQueryDto } from "./dto/search-query.dto";
import { CommitVersionDto } from "./dto/commit-version.dto";
import { QueryContentDto } from "./dto/query-content.dto";
import { QueryEditContentDto } from "./dto/query-edit-content.dto";
import { EditContentResponseDto } from "./dto/edit-content-response.dto";
import { UpdateEditorStateDto } from "./dto/update-editor-state.dto";
import { ExportDocumentDto } from "./dto/export-document.dto";
import { SyncStateResponseDto } from "./dto/sync-state-response.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AuditLog } from "../../common/decorators/audit-log.decorator";
import { SitePublic, isSitePublicAnonymousUserId } from "../../common/decorators/public.decorator";
import { DocumentExportService } from "./services/document-export.service";

@ApiTags("documents")
@Controller("documents")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly documentExportService: DocumentExportService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AuditLog({ action: "CREATE", resourceType: "document" })
  @ApiOperation({ summary: "Create document" })
  @ApiResponse({ status: 201, description: "Created" })
  @ApiResponse({ status: 400, description: "Bad request" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async create(@Body() createDocumentDto: CreateDocumentDto, @CurrentUser() user: any) {
    return this.documentsService.create(createDocumentDto, user.userId);
  }

  @Get()
  @SitePublic()
  @ApiOperation({ summary: "List documents" })
  @ApiResponse({ status: 200, description: "Success" })
  async findAll(@Query() queryDto: QueryDocumentsDto, @CurrentUser() user: any) {
    if (isSitePublicAnonymousUserId(user?.userId)) {
      return this.documentsService.findAllSitePublic(queryDto);
    }
    return this.documentsService.findAll(queryDto, user.userId);
  }

  @Get("search")
  @ApiOperation({ summary: "Search documents" })
  @ApiResponse({ status: 200, description: "Success" })
  async search(@Query() searchQueryDto: SearchQueryDto, @CurrentUser() user: any) {
    return this.documentsService.search(searchQueryDto, user.userId);
  }

  @Get(":docId")
  @SitePublic()
  @ApiOperation({ summary: "Get document details" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success" })
  @ApiResponse({ status: 404, description: "Document not found" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async findOne(@Param("docId") docId: string, @CurrentUser() user: any) {
    if (isSitePublicAnonymousUserId(user?.userId)) {
      return this.documentsService.findOneSitePublic(docId);
    }
    return this.documentsService.findOne(docId, user.userId);
  }

  @Get(":docId/content")
  @SitePublic()
  @ApiOperation({ summary: "Get document content" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success" })
  @ApiResponse({ status: 404, description: "Document not found" })
  async getContent(
    @Param("docId") docId: string,
    @Query() queryDto: QueryContentDto,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    let result: unknown;
    if (isSitePublicAnonymousUserId(user?.userId)) {
      result = await this.documentsService.getContentSitePublic(
        docId,
        queryDto.version,
        queryDto.maxDepth,
        queryDto.startBlockId,
        queryDto.limit,
        queryDto.mode,
      );
      return this.withRenderDiagnosticsHeaders(result, response);
    }
    result = await this.documentsService.getContent(
      docId,
      queryDto.version,
      user.userId,
      queryDto.maxDepth,
      queryDto.startBlockId,
      queryDto.limit,
      queryDto.mode,
    );
    return this.withRenderDiagnosticsHeaders(result, response);
  }

  @Get(":docId/edit-content")
  @ApiOperation({ summary: "Get editor content" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success", type: EditContentResponseDto })
  async getEditContent(
    @Param("docId") docId: string,
    @Query() queryDto: QueryEditContentDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.getEditContent(
      docId,
      user.userId,
      queryDto.maxDepth,
      queryDto.startBlockId,
      queryDto.limit,
    );
  }

  private withRenderDiagnosticsHeaders(result: unknown, response: Response) {
    if (!result || typeof result !== "object") {
      return result;
    }

    const content = result as Record<string, unknown> & {
      renderDiagnostics?: ContentRenderDiagnostics;
    };
    const diagnostics = content.renderDiagnostics;
    if (!diagnostics) {
      return result;
    }

    response.setHeader("X-Yuediter-Content-Mode", diagnostics.requestedMode);
    response.setHeader("X-Yuediter-Render-Mode", diagnostics.renderMode);
    response.setHeader("X-Yuediter-Render-Cache", diagnostics.cache);
    response.setHeader("X-Yuediter-Render-Version", diagnostics.renderVersion);
    response.setHeader(
      "X-Yuediter-Render-Blocks",
      [
        `total=${diagnostics.totalBlocks}`,
        `renderable=${diagnostics.renderableBlocks}`,
        `cached=${diagnostics.cachedBlocks}`,
        `fresh=${diagnostics.freshBlocks}`,
        `client=${diagnostics.clientBlocks}`,
        `failed=${diagnostics.failedBlocks}`,
      ].join(";"),
    );

    const { renderDiagnostics, ...publicContent } = content;
    return publicContent;
  }

  @Patch(":docId")
  @ApiOperation({ summary: "Update document metadata" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success" })
  @ApiResponse({ status: 404, description: "Document not found" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async update(
    @Param("docId") docId: string,
    @Body() updateDocumentDto: UpdateDocumentDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.update(docId, updateDocumentDto, user.userId);
  }

  @Patch(":docId/editor-state")
  @ApiOperation({ summary: "Update document editor state" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success" })
  async updateEditorState(
    @Param("docId") docId: string,
    @Body() updateEditorStateDto: UpdateEditorStateDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.updateEditorState(docId, updateEditorStateDto, user.userId);
  }

  @Post(":docId/publish")
  @ApiOperation({ summary: "Publish document" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success" })
  @ApiResponse({ status: 404, description: "Document not found" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async publish(@Param("docId") docId: string, @CurrentUser() user: any) {
    return this.documentsService.publish(docId, user.userId);
  }

  @Post(":docId/move")
  @ApiOperation({ summary: "Move document" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success" })
  @ApiResponse({ status: 404, description: "Document not found" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 400, description: "Invalid move" })
  async move(
    @Param("docId") docId: string,
    @Body() moveDocumentDto: MoveDocumentDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.move(docId, moveDocumentDto, user.userId);
  }

  @Delete(":docId")
  @HttpCode(HttpStatus.OK)
  @AuditLog({ action: "DELETE", resourceType: "document", resourceIdKey: "docId" })
  @ApiOperation({ summary: "Delete document" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success" })
  @ApiResponse({ status: 404, description: "Document not found" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async remove(@Param("docId") docId: string, @CurrentUser() user: any) {
    return this.documentsService.remove(docId, user.userId);
  }

  @Delete(":docId/draft")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Discard current draft" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success" })
  async discardDraft(@Param("docId") docId: string, @CurrentUser() user: any) {
    return this.documentsService.discardDraft(docId, user.userId);
  }

  @Get(":docId/revisions")
  @ApiOperation({ summary: "Get revision history" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success" })
  @ApiResponse({ status: 404, description: "Document not found" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getRevisions(
    @Param("docId") docId: string,
    @Query() queryDto: QueryRevisionsDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.getRevisions(docId, queryDto, user.userId);
  }

  @Get(":docId/diff")
  @ApiOperation({ summary: "Diff revisions" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success" })
  @ApiResponse({ status: 400, description: "Bad request" })
  @ApiResponse({ status: 404, description: "Document or revision not found" })
  async getDiff(
    @Param("docId") docId: string,
    @Query() queryDto: DiffVersionsDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.getDiff(docId, queryDto.fromVer, queryDto.toVer, user.userId);
  }

  @Post(":docId/revert")
  @ApiOperation({ summary: "Revert to revision" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success" })
  @ApiResponse({ status: 400, description: "Bad request" })
  @ApiResponse({ status: 404, description: "Document or revision not found" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async revert(
    @Param("docId") docId: string,
    @Body() revertDto: RevertVersionDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.revert(docId, revertDto.version, user.userId);
  }

  @Post(":docId/snapshots")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create snapshot" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 201, description: "Created" })
  @ApiResponse({ status: 404, description: "Document not found" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async createSnapshot(@Param("docId") docId: string, @CurrentUser() user: any) {
    return this.documentsService.createSnapshot(docId, user.userId);
  }

  @Post(":docId/commit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Commit version" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success" })
  @ApiResponse({ status: 400, description: "No pending version" })
  @ApiResponse({ status: 404, description: "Document not found" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async commitVersion(
    @Param("docId") docId: string,
    @Body() commitDto: CommitVersionDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.commitVersion(docId, commitDto.message, user.userId);
  }

  @Get(":docId/export")
  @ApiOperation({ summary: "Export document" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiQuery({ name: "format", required: false, enum: ["md", "html", "pdf"] })
  @ApiResponse({ status: 200, description: "Export succeeded" })
  @ApiResponse({ status: 404, description: "Document not found" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async exportDocument(
    @Param("docId") docId: string,
    @Query() queryDto: ExportDocumentDto,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const artifact = await this.documentExportService.exportDocument(
      docId,
      queryDto.format || "md",
      user.userId,
    );

    response.setHeader("Content-Type", artifact.contentType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${artifact.filename.replace(/"/g, '\\"')}"`,
    );
    response.setHeader("Content-Length", artifact.buffer.length.toString());

    return new StreamableFile(artifact.buffer);
  }

  @Get(":docId/pending-versions")
  @ApiOperation({ summary: "Get pending version count" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success" })
  @ApiResponse({ status: 404, description: "Document not found" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getPendingVersions(@Param("docId") docId: string, @CurrentUser() user: any) {
    return this.documentsService.getPendingVersions(docId, user.userId);
  }

  @Get(":docId/sync-state")
  @ApiOperation({ summary: "Get document sync state" })
  @ApiParam({ name: "docId", description: "Document ID" })
  @ApiResponse({ status: 200, description: "Success", type: SyncStateResponseDto })
  @ApiResponse({ status: 404, description: "Document not found" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async getSyncState(@Param("docId") docId: string, @CurrentUser() user: any) {
    return this.documentsService.getSyncState(docId, user.userId);
  }
}
