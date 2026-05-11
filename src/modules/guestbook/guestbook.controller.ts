import { Controller, Get, Post, Body, Req, Query, Param, ParseIntPipe } from '@nestjs/common';
import type { Request } from 'express';
import { GuestbookService } from './guestbook.service';
import { GuestbookLikeService } from './guestbook-like.service';
import { CreateGuestbookDto } from './dto/create-guestbook.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { Public } from '../../common/decorators/public.decorator';

@Controller('guestbook')
export class GuestbookController {
  constructor(
    private readonly guestbookService: GuestbookService,
    private readonly likeService: GuestbookLikeService,
  ) {}

  @Public()
  @Get()
  findAll(@Query() query: PaginationDto) {
    return this.guestbookService.findAll(query.page, query.pageSize);
  }

  @Public()
  @Post()
  create(@Body() dto: CreateGuestbookDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    return this.guestbookService.create(dto, ip, userAgent);
  }

  @Public()
  @Get(':id/replies')
  findReplies(@Param('id', ParseIntPipe) id: number) {
    return this.guestbookService.findReplies(id);
  }

  @Public()
  @Post(':id/like')
  toggleLike(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    return this.likeService.toggle(id, ip, userAgent);
  }
}
