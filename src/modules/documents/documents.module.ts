import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { VersionControlService } from './services/version-control.service';
import { Document } from '../../entities/document.entity';
import { Block } from '../../entities/block.entity';
import { BlockVersion } from '../../entities/block-version.entity';
import { DocRevision } from '../../entities/doc-revision.entity';
import { DocSnapshot } from '../../entities/doc-snapshot.entity';
import { Tag } from '../../entities/tag.entity';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ActivitiesModule } from '../activities/activities.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, Block, BlockVersion, DocRevision, DocSnapshot, Tag]),
    WorkspacesModule,
    ActivitiesModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, VersionControlService],
  exports: [DocumentsService, VersionControlService],
})
export class DocumentsModule {}
