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
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { QueryTagsDto } from './dto/query-tags.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SitePublic } from '../../common/decorators/public.decorator';

@ApiTags('tags')
@Controller('tags')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建标签' })
  @ApiResponse({ status: 201, description: '创建成功' })
  @ApiResponse({ status: 409, description: '同名标签已存在' })
  async create(@Body() dto: CreateTagDto, @CurrentUser() user: any) {
    return this.tagsService.create(dto, user.userId);
  }

  @Get()
  @SitePublic()
  @ApiOperation({ summary: '获取标签列表' })
  @ApiResponse({ status: 200, description: '获取成功' })
  async findAll(@Query() dto: QueryTagsDto, @CurrentUser() user: any) {
    return this.tagsService.findAll(dto, user.userId);
  }

  @Get(':tagId/usage')
  @ApiOperation({ summary: '获取标签使用统计' })
  @ApiParam({ name: 'tagId', description: '标签 ID' })
  @ApiResponse({ status: 200, description: '返回 usage（使用该标签的文档数）' })
  async getUsage(@Param('tagId') tagId: string, @CurrentUser() user: any) {
    return this.tagsService.getUsage(tagId, user.userId);
  }

  @Get(':tagId')
  @ApiOperation({ summary: '获取标签详情' })
  @ApiParam({ name: 'tagId', description: '标签 ID' })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 404, description: '标签不存在' })
  async findOne(@Param('tagId') tagId: string, @CurrentUser() user: any) {
    return this.tagsService.findOne(tagId, user.userId);
  }

  @Patch(':tagId')
  @ApiOperation({ summary: '更新标签' })
  @ApiParam({ name: 'tagId', description: '标签 ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 404, description: '标签不存在' })
  @ApiResponse({ status: 409, description: '同名标签已存在' })
  async update(@Param('tagId') tagId: string, @Body() dto: UpdateTagDto, @CurrentUser() user: any) {
    return this.tagsService.update(tagId, dto, user.userId);
  }

  @Delete(':tagId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除标签' })
  @ApiParam({ name: 'tagId', description: '标签 ID' })
  @ApiResponse({ status: 200, description: '删除成功，并从所有文档的 tags 中移除' })
  @ApiResponse({ status: 404, description: '标签不存在' })
  async remove(@Param('tagId') tagId: string, @CurrentUser() user: any) {
    return this.tagsService.remove(tagId, user.userId);
  }
}
