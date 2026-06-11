import { Module } from "@nestjs/common";
// cspell:words Millis
import { APP_GUARD } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ConfigModule as AppConfigModule } from "./config/config.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AdminAuthModule } from "./modules/admin-auth/admin-auth.module";
import { ReactionsModule } from "./modules/reactions/reactions.module";
import { GuestbookModule } from "./modules/guestbook/guestbook.module";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { BlocksModule } from "./modules/blocks/blocks.module";
import { AssetsModule } from "./modules/assets/assets.module";
import { ImagesModule } from "./modules/images/images.module";
import { SecurityModule } from "./modules/security/security.module";
import { TagsModule } from "./modules/tags/tags.module";
import { FavoritesModule } from "./modules/favorites/favorites.module";
import { CommentsModule } from "./modules/comments/comments.module";
import { SearchModule } from "./modules/search/search.module";
import { ActivitiesModule } from "./modules/activities/activities.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { RuntimeConfigModule } from "./modules/runtime-config/runtime-config.module";
import { RuntimeConfigService } from "./modules/runtime-config/runtime-config.service";
import { GcModule } from "./modules/gc/gc.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";

// 导入所有实体
import { User } from "./entities/user.entity";
import { Admin } from "./entities/admin.entity";
import { Workspace } from "./entities/workspace.entity";
import { WorkspaceMember } from "./entities/workspace-member.entity";
import { Document } from "./entities/document.entity";
import { Block } from "./entities/block.entity";
import { BlockVersion } from "./entities/block-version.entity";
import { BlockRenderCache } from "./entities/block-render-cache.entity";
import { DocRevision } from "./entities/doc-revision.entity";
import { DocSnapshot } from "./entities/doc-snapshot.entity";
import { DocDraft } from "./entities/doc-draft.entity";
import { Asset } from "./entities/asset.entity";
import { Tag } from "./entities/tag.entity";
import { Favorite } from "./entities/favorite.entity";
import { Comment } from "./entities/comment.entity";
import { Activity } from "./entities/activity.entity";
import { Session } from "./entities/session.entity";
import { AuditLog } from "./entities/audit-log.entity";
import { SecurityLog } from "./entities/security-log.entity";
import { SettingsProfile } from "./entities/settings-profile.entity";
import { RuntimeConfig } from "./entities/runtime-config.entity";
import { GcRun } from "./entities/gc-run.entity";
import { GcRunCandidate } from "./entities/gc-run-candidate.entity";
import { GcCandidatePool } from "./entities/gc-candidate-pool.entity";
import { Emoji } from "./entities/emoji.entity";
import { Reaction } from "./entities/reaction.entity";
import { Guestbook } from "./entities/guestbook.entity";
import { GuestbookLike } from "./entities/guestbook-like.entity";
import { SensitiveWord } from "./entities/sensitive-word.entity";
import { SyncBatchReceipt } from "./entities/sync-batch-receipt.entity";
import { SyncCheckpointReceipt } from "./entities/sync-checkpoint-receipt.entity";
import { SyncReconcileReceipt } from "./entities/sync-reconcile-receipt.entity";
import { DocumentSyncSession } from "./entities/document-sync-session.entity";
import { SyncCreateTombstone } from "./entities/sync-create-tombstone.entity";

export const databaseEntities = [
  User,
  Admin,
  Workspace,
  WorkspaceMember,
  Document,
  Block,
  BlockVersion,
  BlockRenderCache,
  DocRevision,
  DocSnapshot,
  DocDraft,
  Asset,
  Tag,
  Favorite,
  Comment,
  Activity,
  Session,
  AuditLog,
  SecurityLog,
  SettingsProfile,
  RuntimeConfig,
  GcRun,
  GcRunCandidate,
  GcCandidatePool,
  Emoji,
  Reaction,
  Guestbook,
  GuestbookLike,
  SensitiveWord,
  SyncBatchReceipt,
  SyncCheckpointReceipt,
  SyncReconcileReceipt,
  DocumentSyncSession,
  SyncCreateTombstone,
];

@Module({
  imports: [
    // 配置模块
    AppConfigModule,

    // 数据库模块
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const dbType = configService.get<string>("database.type") || "postgres";
        const isSqlite = dbType === "better-sqlite3";

        const baseConfig: Record<string, unknown> = {
          type: dbType,
          database: configService.get<string>("database.database"),
          entities: databaseEntities,
          synchronize: configService.get<string>("app.env") === "development",
          logging: configService.get<boolean>("database.logging") ?? false,
          manualInitialization: process.env.OPENAPI_EXPORT === "true",
        };

        if (!isSqlite) {
          baseConfig.host = configService.get<string>("database.host");
          baseConfig.port = configService.get<number>("database.port");
          baseConfig.username = configService.get<string>("database.username");
          baseConfig.password = configService.get<string>("database.password");
          baseConfig.extra = {
            max: configService.get<number>("database.extra.max"),
            min: configService.get<number>("database.extra.min"),
            idleTimeoutMillis: configService.get<number>(
              "database.extra.idleTimeoutMillis",
            ),
            connectionTimeoutMillis: configService.get<number>(
              "database.extra.connectionTimeoutMillis",
            ),
          };
        }

        return baseConfig;
      },
      inject: [ConfigService],
    }),

    // 运行时配置模块（支持热更新，供限流等系统能力使用）
    RuntimeConfigModule,
    GcModule,
    RealtimeModule,

    // 限流（可运行时热更新 enabled/ttl/limit）
    ThrottlerModule.forRootAsync({
      imports: [RuntimeConfigModule],
      inject: [RuntimeConfigService],
      useFactory: (runtimeConfigService: RuntimeConfigService) => [
        {
          ttl: () => runtimeConfigService.getRateLimitConfigForGuard().ttlMs,
          limit: () => runtimeConfigService.getRateLimitConfigForGuard().limit,
          skipIf: () =>
            !runtimeConfigService.getRateLimitConfigForGuard().enabled,
        },
      ],
    }),

    // 功能模块（SecurityModule 为 @Global，需先加载以便 SecurityService / AuditService 可注入）
    SecurityModule,
    AuthModule,
    AdminAuthModule,
    ReactionsModule,
    GuestbookModule,
    WorkspacesModule,
    DocumentsModule,
    BlocksModule,
    AssetsModule,
    ImagesModule,
    TagsModule,
    FavoritesModule,
    CommentsModule,
    SearchModule,
    ActivitiesModule,
    SettingsModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
