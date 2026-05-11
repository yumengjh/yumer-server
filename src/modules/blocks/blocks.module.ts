import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlocksController } from './blocks.controller';
import { BlocksService } from './blocks.service';
import { Block } from '../../entities/block.entity';
import { BlockVersion } from '../../entities/block-version.entity';
import { Document } from '../../entities/document.entity';
import { DocRevision } from '../../entities/doc-revision.entity';
import { DocumentsModule } from '../documents/documents.module';
import { ActivitiesModule } from '../activities/activities.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Block, BlockVersion, Document, DocRevision]),
    forwardRef(() => DocumentsModule), // 使用 forwardRef 解决循环依赖
    ActivitiesModule,
  ],
  controllers: [BlocksController],
  providers: [BlocksService],
  exports: [BlocksService],
})
export class BlocksModule {}
