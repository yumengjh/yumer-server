import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { DocumentSnapshotService } from "./services/document-snapshot.service";
import { DocumentHtmlRendererService } from "./services/document-html-renderer.service";
import { DocumentRenderService } from "./services/document-render.service";
import { VersionControlService } from "./services/version-control.service";
import { Document } from "../../entities/document.entity";
import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { BlockRenderCache } from "../../entities/block-render-cache.entity";
import { DocRevision } from "../../entities/doc-revision.entity";
import { DocSnapshot } from "../../entities/doc-snapshot.entity";
import { Tag } from "../../entities/tag.entity";
import { User } from "../../entities/user.entity";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ActivitiesModule } from "../activities/activities.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Document,
      Block,
      BlockVersion,
      BlockRenderCache,
      DocRevision,
      DocSnapshot,
      Tag,
      User,
    ]),
    WorkspacesModule,
    ActivitiesModule,
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    VersionControlService,
    DocumentSnapshotService,
    DocumentHtmlRendererService,
    DocumentRenderService,
  ],
  exports: [
    DocumentsService,
    VersionControlService,
    DocumentSnapshotService,
    DocumentRenderService,
  ],
})
export class DocumentsModule {}
