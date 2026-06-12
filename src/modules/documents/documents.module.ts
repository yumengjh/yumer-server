import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { DocumentExportService } from "./services/document-export.service";
import { DocumentSnapshotService } from "./services/document-snapshot.service";
import { DocumentHtmlRendererService } from "./services/document-html-renderer.service";
import { DocumentRenderService } from "./services/document-render.service";
import { DocumentDraftService } from "./services/document-draft.service";
import { VersionControlService } from "./services/version-control.service";
import { DraftCheckpointService } from "./draft-checkpoint.service";
import { Document } from "../../entities/document.entity";
import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { BlockRenderCache } from "../../entities/block-render-cache.entity";
import { DocRevision } from "../../entities/doc-revision.entity";
import { DocSnapshot } from "../../entities/doc-snapshot.entity";
import { DocDraft } from "../../entities/doc-draft.entity";
import { Tag } from "../../entities/tag.entity";
import { User } from "../../entities/user.entity";
import { SyncCheckpointReceipt } from "../../entities/sync-checkpoint-receipt.entity";
import { SyncReconcileReceipt } from "../../entities/sync-reconcile-receipt.entity";
import { DocumentSyncSession } from "../../entities/document-sync-session.entity";
import { SyncCreateTombstone } from "../../entities/sync-create-tombstone.entity";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ActivitiesModule } from "../activities/activities.module";
import { GcRenderCacheModule } from "../gc/modules/render-cache/gc-render-cache.module";
import { BlockPayloadResolverService } from "../blocks/block-delta/block-payload-resolver.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Document,
      Block,
      BlockVersion,
      BlockRenderCache,
      DocRevision,
      DocSnapshot,
      DocDraft,
      Tag,
      User,
      SyncCheckpointReceipt,
      SyncReconcileReceipt,
      DocumentSyncSession,
      SyncCreateTombstone,
    ]),
    WorkspacesModule,
    ActivitiesModule,
    GcRenderCacheModule,
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentExportService,
    VersionControlService,
    DocumentDraftService,
    DocumentSnapshotService,
    DocumentHtmlRendererService,
    DocumentRenderService,
    DraftCheckpointService,
    BlockPayloadResolverService,
  ],
  exports: [
    DocumentsService,
    DocumentExportService,
    VersionControlService,
    DocumentDraftService,
    DocumentSnapshotService,
    DocumentRenderService,
  ],
})
export class DocumentsModule {}
