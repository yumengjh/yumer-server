import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tag } from '../../entities/tag.entity';
import { Document } from '../../entities/document.entity';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ActivitiesModule } from '../activities/activities.module';

@Module({
  imports: [TypeOrmModule.forFeature([Tag, Document]), WorkspacesModule, ActivitiesModule],
  controllers: [TagsController],
  providers: [TagsService],
  exports: [TagsService],
})
export class TagsModule {}
