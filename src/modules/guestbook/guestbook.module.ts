import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GuestbookController } from './guestbook.controller';
import { GuestbookAdminController } from './guestbook-admin.controller';
import { GuestbookService } from './guestbook.service';
import { GuestbookLikeService } from './guestbook-like.service';
import { SensitiveWordService } from './sensitive-word.service';
import { Guestbook } from '../../entities/guestbook.entity';
import { GuestbookLike } from '../../entities/guestbook-like.entity';
import { SensitiveWord } from '../../entities/sensitive-word.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Guestbook, GuestbookLike, SensitiveWord])],
  controllers: [GuestbookController, GuestbookAdminController],
  providers: [GuestbookService, GuestbookLikeService, SensitiveWordService],
})
export class GuestbookModule {}
