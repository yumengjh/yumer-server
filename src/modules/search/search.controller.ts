import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { AdvancedSearchDto } from './dto/advanced-search.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('搜索')
@Controller('search')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({ summary: '全局搜索' })
  @ApiResponse({ status: 200, description: '返回文档与块匹配结果' })
  async globalSearch(@Query() dto: SearchQueryDto, @CurrentUser() user: { userId: string }) {
    return this.searchService.globalSearch(dto, user.userId);
  }

  @Post('advanced')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '高级搜索' })
  @ApiResponse({ status: 200, description: '支持标签、时间范围、创建者、排序' })
  async advancedSearch(@Body() dto: AdvancedSearchDto, @CurrentUser() user: { userId: string }) {
    return this.searchService.advancedSearch(dto, user.userId);
  }
}
