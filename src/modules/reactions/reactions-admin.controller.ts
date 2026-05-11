import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ReactionsService } from './reactions.service';
import { CreateEmojiDto } from './dto/create-emoji.dto';
import { UpdateEmojiDto } from './dto/update-emoji.dto';
import { QueryReactionDto } from './dto/query-reaction.dto';

@Controller('admin/reactions')
export class ReactionsAdminController {
  constructor(private readonly reactionsService: ReactionsService) {}

  // ─── Emoji 管理 ───

  @Get('emojis')
  getEmojis() {
    return this.reactionsService.findAllEmojis(true);
  }

  @Post('emojis')
  createEmoji(@Body() dto: CreateEmojiDto) {
    return this.reactionsService.createEmoji(dto);
  }

  @Patch('emojis/:id')
  updateEmoji(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmojiDto) {
    return this.reactionsService.updateEmoji(id, dto);
  }

  @Delete('emojis/:id')
  removeEmoji(@Param('id', ParseIntPipe) id: number) {
    return this.reactionsService.removeEmoji(id);
  }

  // ─── 回应记录管理 ───

  @Get('records')
  getRecords(@Query() query: QueryReactionDto) {
    return this.reactionsService.findAllRecords(
      query.page,
      query.pageSize,
      query.targetType,
      query.targetId,
    );
  }

  @Delete('records/:id')
  removeRecord(@Param('id', ParseIntPipe) id: number) {
    return this.reactionsService.removeRecord(id);
  }
}
