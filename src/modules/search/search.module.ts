import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../../entities/document.entity';
import { BlockVersion } from '../../entities/block-version.entity';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Document, BlockVersion]), WorkspacesModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
