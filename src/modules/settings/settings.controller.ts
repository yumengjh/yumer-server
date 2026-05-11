import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateMySettingsDto } from './dto/update-my-settings.dto';
import { QueryEffectiveSettingsDto } from './dto/query-effective-settings.dto';
import { UpdateWorkspaceSettingsDto } from './dto/update-workspace-settings.dto';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { SitePublic } from '../../common/decorators/public.decorator';

@ApiTags('settings')
@Controller()
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('settings/me')
  @ApiOperation({ summary: '获取当前用户设置（含默认值）' })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 401, description: '未认证' })
  async getMySettings(@CurrentUser() user: { userId: string }) {
    return this.settingsService.getMySettings(user.userId);
  }

  @Patch('settings/me')
  @ApiOperation({ summary: '更新当前用户设置（部分更新）' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  @ApiResponse({ status: 401, description: '未认证' })
  async updateMySettings(
    @Body() body: UpdateMySettingsDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.settingsService.updateMySettings(user.userId, body.settings);
  }

  @Get('settings/effective')
  @ApiOperation({
    summary: '获取生效设置（可选 workspaceId）',
    description: '返回 userSettings / workspaceSettings / effectiveSettings / sources',
  })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 401, description: '未认证' })
  @ApiResponse({ status: 403, description: '无工作空间访问权限（传 workspaceId 时）' })
  @ApiResponse({ status: 404, description: '工作空间不存在（传 workspaceId 时）' })
  async getEffectiveSettings(
    @Query() query: QueryEffectiveSettingsDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.settingsService.getEffectiveSettings(user.userId, query.workspaceId);
  }

  @Get('workspaces/:workspaceId/settings')
  @SitePublic()
  @ApiOperation({ summary: '获取工作空间覆盖设置（原始覆盖）' })
  @ApiParam({ name: 'workspaceId', description: '工作空间ID' })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 401, description: '未认证' })
  @ApiResponse({ status: 403, description: '无访问权限' })
  @ApiResponse({ status: 404, description: '工作空间不存在' })
  async getWorkspaceSettings(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.settingsService.getWorkspaceSettings(workspaceId, user.userId);
  }

  @Patch('workspaces/:workspaceId/settings')
  @AuditLog({
    action: 'UPDATE',
    resourceType: 'workspace_settings',
    resourceIdKey: 'workspaceId',
  })
  @ApiOperation({ summary: '更新工作空间覆盖设置（owner/admin）' })
  @ApiParam({ name: 'workspaceId', description: '工作空间ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  @ApiResponse({ status: 401, description: '未认证' })
  @ApiResponse({ status: 403, description: '无管理权限' })
  @ApiResponse({ status: 404, description: '工作空间不存在' })
  async updateWorkspaceSettings(
    @Param('workspaceId') workspaceId: string,
    @Body() body: UpdateWorkspaceSettingsDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.settingsService.updateWorkspaceSettings(workspaceId, user.userId, body.settings);
  }

  @Delete('workspaces/:workspaceId/settings')
  @HttpCode(HttpStatus.OK)
  @AuditLog({
    action: 'DELETE',
    resourceType: 'workspace_settings',
    resourceIdKey: 'workspaceId',
  })
  @ApiOperation({ summary: '清空工作空间覆盖设置（owner/admin）' })
  @ApiParam({ name: 'workspaceId', description: '工作空间ID' })
  @ApiResponse({ status: 200, description: '清空成功' })
  @ApiResponse({ status: 401, description: '未认证' })
  @ApiResponse({ status: 403, description: '无管理权限' })
  @ApiResponse({ status: 404, description: '工作空间不存在' })
  async clearWorkspaceSettings(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.settingsService.clearWorkspaceSettings(workspaceId, user.userId);
  }
}
