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
import { BlocksService } from './blocks.service';
import { CreateBlockDto } from './dto/create-block.dto';
import { UpdateBlockDto } from './dto/update-block.dto';
import { MoveBlockDto } from './dto/move-block.dto';
import { BatchBlockDto } from './dto/batch-block.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('blocks')
@Controller('blocks')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建块' })
  @ApiResponse({ status: 201, description: '创建成功' })
  @ApiResponse({ status: 400, description: '请求参数错误' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async create(@Body() createBlockDto: CreateBlockDto, @CurrentUser() user: any) {
    return this.blocksService.create(createBlockDto, user.userId);
  }

  @Patch(':blockId/content')
  @ApiOperation({ summary: '更新块内容' })
  @ApiParam({ name: 'blockId', description: '块ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 404, description: '块不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async updateContent(
    @Param('blockId') blockId: string,
    @Body() updateBlockDto: UpdateBlockDto,
    @CurrentUser() user: any,
  ) {
    return this.blocksService.updateContent(blockId, updateBlockDto, user.userId);
  }

  @Post(':blockId/move')
  @ApiOperation({ summary: '移动块' })
  @ApiParam({ name: 'blockId', description: '块ID' })
  @ApiResponse({ status: 200, description: '移动成功' })
  @ApiResponse({ status: 404, description: '块不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  @ApiResponse({ status: 400, description: '移动操作无效' })
  async move(
    @Param('blockId') blockId: string,
    @Body() moveBlockDto: MoveBlockDto,
    @CurrentUser() user: any,
  ) {
    return this.blocksService.move(blockId, moveBlockDto, user.userId);
  }

  @Delete(':blockId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除块' })
  @ApiParam({ name: 'blockId', description: '块ID' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '块不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async remove(@Param('blockId') blockId: string, @CurrentUser() user: any) {
    return this.blocksService.remove(blockId, user.userId);
  }

  @Get(':blockId/versions')
  @ApiOperation({ summary: '获取块版本历史' })
  @ApiParam({ name: 'blockId', description: '块ID' })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 404, description: '块不存在' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async getVersions(
    @Param('blockId') blockId: string,
    @Query() paginationDto: PaginationDto,
    @CurrentUser() user: any,
  ) {
    return this.blocksService.getVersions(blockId, paginationDto, user.userId);
  }

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '批量操作块' })
  @ApiResponse({ status: 200, description: '批量操作成功' })
  @ApiResponse({ status: 400, description: '请求参数错误' })
  @ApiResponse({ status: 403, description: '没有权限' })
  async batch(@Body() batchBlockDto: BatchBlockDto, @CurrentUser() user: any) {
    return this.blocksService.batch(batchBlockDto, user.userId);
  }
}
