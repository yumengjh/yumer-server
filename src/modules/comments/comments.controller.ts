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
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { QueryCommentsDto } from './dto/query-comments.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('comments')
@Controller('comments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建评论（含回复）' })
  @ApiResponse({ status: 201, description: '创建成功' })
  @ApiResponse({ status: 404, description: '文档或父评论不存在' })
  async create(@Body() dto: CreateCommentDto, @CurrentUser() user: any) {
    return this.commentsService.create(dto, user.userId);
  }

  @Get()
  @ApiOperation({ summary: '获取评论列表' })
  @ApiResponse({ status: 200, description: '获取成功' })
  async findAll(@Query() dto: QueryCommentsDto, @CurrentUser() user: any) {
    return this.commentsService.findAll(dto, user.userId);
  }

  @Get(':commentId')
  @ApiOperation({ summary: '获取评论详情' })
  @ApiParam({ name: 'commentId', description: '评论 ID' })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 404, description: '评论不存在' })
  async findOne(@Param('commentId') commentId: string, @CurrentUser() user: any) {
    return this.commentsService.findOne(commentId, user.userId);
  }

  @Patch(':commentId')
  @ApiOperation({ summary: '更新评论' })
  @ApiParam({ name: 'commentId', description: '评论 ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 403, description: '只能修改自己的评论' })
  async update(
    @Param('commentId') commentId: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: any,
  ) {
    return this.commentsService.update(commentId, dto, user.userId);
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除评论' })
  @ApiParam({ name: 'commentId', description: '评论 ID' })
  @ApiResponse({ status: 200, description: '删除成功（软删除）' })
  @ApiResponse({ status: 403, description: '只能删除自己的评论' })
  async remove(@Param('commentId') commentId: string, @CurrentUser() user: any) {
    return this.commentsService.remove(commentId, user.userId);
  }
}
