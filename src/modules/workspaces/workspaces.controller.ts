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
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SitePublic } from '../../common/decorators/public.decorator';

@ApiTags('workspaces')
@Controller('workspaces')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建工作空间' })
  @ApiResponse({ status: 201, description: '创建成功' })
  @ApiResponse({ status: 400, description: '请求参数错误' })
  async create(@Body() createWorkspaceDto: CreateWorkspaceDto, @CurrentUser() user: any) {
    return this.workspacesService.create(createWorkspaceDto, user.userId);
  }

  @Get()
  @ApiOperation({ summary: '获取工作空间列表' })
  @ApiResponse({ status: 200, description: '获取成功' })
  async findAll(@Query() paginationDto: PaginationDto, @CurrentUser() user: any) {
    return this.workspacesService.findAll(user.userId, paginationDto);
  }

  @Get(':workspaceId')
  @SitePublic()
  @ApiOperation({ summary: '获取工作空间详情' })
  @ApiParam({ name: 'workspaceId', description: '工作空间ID' })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 404, description: '工作空间不存在' })
  @ApiResponse({ status: 403, description: '没有权限访问' })
  async findOne(@Param('workspaceId') workspaceId: string, @CurrentUser() user: any) {
    return this.workspacesService.findOne(workspaceId, user.userId);
  }

  @Patch(':workspaceId')
  @ApiOperation({ summary: '更新工作空间' })
  @ApiParam({ name: 'workspaceId', description: '工作空间ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 404, description: '工作空间不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async update(
    @Param('workspaceId') workspaceId: string,
    @Body() updateWorkspaceDto: UpdateWorkspaceDto,
    @CurrentUser() user: any,
  ) {
    return this.workspacesService.update(workspaceId, updateWorkspaceDto, user.userId);
  }

  @Delete(':workspaceId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除工作空间' })
  @ApiParam({ name: 'workspaceId', description: '工作空间ID' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '工作空间不存在' })
  @ApiResponse({ status: 403, description: '只有所有者可以删除' })
  async remove(@Param('workspaceId') workspaceId: string, @CurrentUser() user: any) {
    return this.workspacesService.remove(workspaceId, user.userId);
  }

  @Post(':workspaceId/members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '邀请成员' })
  @ApiParam({ name: 'workspaceId', description: '工作空间ID' })
  @ApiResponse({ status: 201, description: '邀请成功' })
  @ApiResponse({ status: 404, description: '工作空间或用户不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  @ApiResponse({ status: 409, description: '用户已经是成员' })
  async inviteMember(
    @Param('workspaceId') workspaceId: string,
    @Body() inviteMemberDto: InviteMemberDto,
    @CurrentUser() user: any,
  ) {
    return this.workspacesService.inviteMember(workspaceId, inviteMemberDto, user.userId);
  }

  @Get(':workspaceId/members')
  @ApiOperation({ summary: '获取成员列表' })
  @ApiParam({ name: 'workspaceId', description: '工作空间ID' })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 404, description: '工作空间不存在' })
  @ApiResponse({ status: 403, description: '没有权限访问' })
  async getMemberList(@Param('workspaceId') workspaceId: string, @CurrentUser() user: any) {
    return this.workspacesService.getMemberList(workspaceId, user.userId);
  }

  @Patch(':workspaceId/members/:userId')
  @ApiOperation({ summary: '更新成员角色' })
  @ApiParam({ name: 'workspaceId', description: '工作空间ID' })
  @ApiParam({ name: 'userId', description: '用户ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 404, description: '工作空间或成员不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  @ApiResponse({ status: 400, description: '不能修改所有者角色' })
  async updateMemberRole(
    @Param('workspaceId') workspaceId: string,
    @Param('userId') userId: string,
    @Body() updateMemberRoleDto: UpdateMemberRoleDto,
    @CurrentUser() user: any,
  ) {
    return this.workspacesService.updateMemberRole(
      workspaceId,
      userId,
      updateMemberRoleDto,
      user.userId,
    );
  }

  @Delete(':workspaceId/members/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '移除成员' })
  @ApiParam({ name: 'workspaceId', description: '工作空间ID' })
  @ApiParam({ name: 'userId', description: '用户ID' })
  @ApiResponse({ status: 200, description: '移除成功' })
  @ApiResponse({ status: 404, description: '工作空间不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  @ApiResponse({ status: 400, description: '不能移除所有者' })
  async removeMember(
    @Param('workspaceId') workspaceId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: any,
  ) {
    return this.workspacesService.removeMember(workspaceId, userId, user.userId);
  }
}
