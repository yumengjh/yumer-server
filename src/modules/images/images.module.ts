import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MulterModule } from "@nestjs/platform-express";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Asset } from "../../entities/asset.entity";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { createImageMulterOptions } from "./image-upload-limits.util";
import { imageStorageProvider } from "./image-storage.factory";
import { ImagesController } from "./images.controller";
import { ImagesService } from "./images.service";
import { IMAGE_STORAGE } from "./image-storage.types";

@Module({
  imports: [
    ConfigModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createImageMulterOptions,
    }),
    TypeOrmModule.forFeature([Asset]),
    WorkspacesModule,
  ],
  controllers: [ImagesController],
  providers: [ImagesService, imageStorageProvider],
  exports: [ImagesService, IMAGE_STORAGE],
})
export class ImagesModule {}
