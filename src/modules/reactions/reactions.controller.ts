import { Controller, Get, Post, Delete, Param, Body, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ReactionsService } from './reactions.service';
import { CreateReactionDto } from './dto/create-reaction.dto';
import { Public } from '../../common/decorators/public.decorator';

@Controller('reactions')
export class ReactionsController {
  constructor(private readonly reactionsService: ReactionsService) {}

  @Public()
  @Get('emojis')
  getEmojis() {
    return this.reactionsService.findAllEmojis();
  }

  @Public()
  @Get(':targetType/:targetId')
  getReactions(@Param('targetType') targetType: string, @Param('targetId') targetId: string) {
    return this.reactionsService.getReactions(targetType, targetId);
  }

  @Public()
  @Post(':targetType/:targetId')
  addReaction(
    @Param('targetType') targetType: string,
    @Param('targetId') targetId: string,
    @Body() dto: CreateReactionDto,
    @Req() req: Request,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    return this.reactionsService.addReaction(targetType, targetId, dto.emojiId, ip, userAgent);
  }

  @Public()
  @Delete(':targetType/:targetId/:emojiCode')
  removeReaction(
    @Param('targetType') targetType: string,
    @Param('targetId') targetId: string,
    @Param('emojiCode') emojiCode: string,
    @Req() req: Request,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '';
    return this.reactionsService.removeReaction(targetType, targetId, emojiCode, ip);
  }
}
