import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Favorite } from '../../entities/favorite.entity';
import { Document } from '../../entities/document.entity';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import { DocumentsModule } from '../documents/documents.module';
import { ActivitiesModule } from '../activities/activities.module';

@Module({
  imports: [TypeOrmModule.forFeature([Favorite, Document]), DocumentsModule, ActivitiesModule],
  controllers: [FavoritesController],
  providers: [FavoritesService],
  exports: [FavoritesService],
})
export class FavoritesModule {}
