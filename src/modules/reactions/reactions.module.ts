import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReactionsController } from './reactions.controller';
import { ReactionsAdminController } from './reactions-admin.controller';
import { ReactionsService } from './reactions.service';
import { Emoji } from '../../entities/emoji.entity';
import { Reaction } from '../../entities/reaction.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Emoji, Reaction])],
  controllers: [ReactionsController, ReactionsAdminController],
  providers: [ReactionsService],
  exports: [ReactionsService],
})
export class ReactionsModule {}
