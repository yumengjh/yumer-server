import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiParam } from '@nestjs/swagger';
import { FavoritesService } from './favorites.service';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { QueryFavoritesDto } from './dto/query-favorites.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('favorites')
@Controller('favorites')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '收藏文档' })
  @ApiResponse({ status: 201, description: '收藏成功' })
  @ApiResponse({ status: 404, description: '文档不存在' })
  @ApiResponse({ status: 409, description: '已经收藏过' })
  async create(@Body() dto: CreateFavoriteDto, @CurrentUser() user: any) {
    return this.favoritesService.create(dto, user.userId);
  }

  @Get()
  @ApiOperation({ summary: '获取收藏列表' })
  @ApiResponse({ status: 200, description: '获取成功，含 document 信息' })
  async findAll(@Query() dto: QueryFavoritesDto, @CurrentUser() user: any) {
    return this.favoritesService.findAll(dto, user.userId);
  }

  @Delete(':docId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消收藏' })
  @ApiParam({ name: 'docId', description: '文档 ID' })
  @ApiResponse({ status: 200, description: '已取消收藏' })
  @ApiResponse({ status: 404, description: '未收藏该文档' })
  async remove(@Param('docId') docId: string, @CurrentUser() user: any) {
    return this.favoritesService.remove(docId, user.userId);
  }
}
