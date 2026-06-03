import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SystemAdminTokenGuard } from "../../../../common/guards/system-admin-token.guard";
import { Block } from "../../../../entities/block.entity";
import { BlockVersion } from "../../../../entities/block-version.entity";
import { DocDraft } from "../../../../entities/doc-draft.entity";
import { DocRevision } from "../../../../entities/doc-revision.entity";
import { DocSnapshot } from "../../../../entities/doc-snapshot.entity";
import { Document } from "../../../../entities/document.entity";
import { GcCandidatePool } from "../../../../entities/gc-candidate-pool.entity";
import { GcRun } from "../../../../entities/gc-run.entity";
import { GcRunCandidate } from "../../../../entities/gc-run-candidate.entity";
import { BlockVersionGcCollector } from "./block-version-gc.collector";
import { GcController } from "./gc.controller";
import { GcHealthService } from "./gc-health.service";
import { GcPolicyService } from "./gc-policy.service";
import { GcRunService } from "./gc-run.service";
import { GcSweepService } from "./gc-sweep.service";
import { BlockVersionGcSubmodule } from "./block-version-gc.submodule";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Block,
      BlockVersion,
      Document,
      DocRevision,
      DocSnapshot,
      DocDraft,
      GcRun,
      GcRunCandidate,
      GcCandidatePool,
    ]),
  ],
  controllers: [GcController],
  providers: [
    SystemAdminTokenGuard,
    GcPolicyService,
    GcHealthService,
    BlockVersionGcCollector,
    GcRunService,
    GcSweepService,
    BlockVersionGcSubmodule,
  ],
  exports: [
    GcPolicyService,
    GcHealthService,
    BlockVersionGcCollector,
    GcRunService,
    GcSweepService,
    BlockVersionGcSubmodule,
  ],
})
export class BlockVersionGcModule {}
