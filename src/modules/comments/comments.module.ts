import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from '../../entities/comment.entity';
import { Document } from '../../entities/document.entity';
import { Block } from '../../entities/block.entity';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { DocumentsModule } from '../documents/documents.module';
import { ActivitiesModule } from '../activities/activities.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Comment, Document, Block]),
    DocumentsModule,
    ActivitiesModule,
  ],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
