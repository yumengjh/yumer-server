import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ActivitiesService } from './activities.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { QueryActivitiesDto } from './dto/query-activities.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('活动日志')
@Controller('activities')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ActivitiesController {
  constructor(
    private readonly activitiesService: ActivitiesService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取活动日志' })
  @ApiResponse({ status: 200, description: '工作空间、用户、操作类型、时间范围、分页' })
  async list(@Query() dto: QueryActivitiesDto, @CurrentUser() user: { userId: string }) {
    await this.workspacesService.checkAccess(dto.workspaceId, user.userId);
    return this.activitiesService.findFiltered(dto);
  }
}
