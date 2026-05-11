import {
  Controller,
  Get,
  Patch,
  Delete,
  Post,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { GuestbookService } from './guestbook.service';
import { SensitiveWordService } from './sensitive-word.service';
import { QueryGuestbookDto } from './dto/query-guestbook.dto';
import { UpdateGuestbookAdminDto } from './dto/update-guestbook-admin.dto';
import { BatchStatusDto } from './dto/batch-status.dto';
import { CreateSensitiveWordDto } from './dto/create-sensitive-word.dto';

@Controller('admin')
export class GuestbookAdminController {
  constructor(
    private readonly guestbookService: GuestbookService,
    private readonly sensitiveWordService: SensitiveWordService,
  ) {}

  // ─── 留言管理 ───

  @Get('guestbook')
  findAll(@Query() query: QueryGuestbookDto) {
    return this.guestbookService.findAllAdmin(query.page, query.pageSize, query.status);
  }

  @Patch('guestbook/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGuestbookAdminDto) {
    return this.guestbookService.updateAdmin(id, dto);
  }

  @Delete('guestbook/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.guestbookService.remove(id);
  }

  @Post('guestbook/batch-status')
  batchStatus(@Body() dto: BatchStatusDto) {
    return this.guestbookService.batchUpdateStatus(dto.ids, dto.status);
  }

  // ─── 敏感词管理 ───

  @Get('sensitive-words')
  findAllSensitiveWords() {
    return this.sensitiveWordService.findAll();
  }

  @Post('sensitive-words')
  createSensitiveWord(@Body() dto: CreateSensitiveWordDto) {
    return this.sensitiveWordService.create(dto);
  }

  @Patch('sensitive-words/:id')
  updateSensitiveWord(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateSensitiveWordDto>,
  ) {
    return this.sensitiveWordService.update(id, dto);
  }

  @Delete('sensitive-words/:id')
  removeSensitiveWord(@Param('id', ParseIntPipe) id: number) {
    return this.sensitiveWordService.remove(id);
  }
}
