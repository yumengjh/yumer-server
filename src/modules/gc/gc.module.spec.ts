import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { getRepositoryToken } from "@nestjs/typeorm";
import { SystemAdminTokenGuard } from "../../common/guards/system-admin-token.guard";
import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { DocDraft } from "../../entities/doc-draft.entity";
import { DocRevision } from "../../entities/doc-revision.entity";
import { DocSnapshot } from "../../entities/doc-snapshot.entity";
import { Document } from "../../entities/document.entity";
import { GcCandidatePool } from "../../entities/gc-candidate-pool.entity";
import { GcRunCandidate } from "../../entities/gc-run-candidate.entity";
import { GcRun } from "../../entities/gc-run.entity";
import { GcModulesController } from "./gc-modules.controller";
import { GcRegistryService } from "./gc-registry.service";
import { GcModule } from "./gc.module";
import { BlockVersionGcCollector } from "./modules/block-version/block-version-gc.collector";
import { GcController } from "./modules/block-version/gc.controller";
import { GcHealthService } from "./modules/block-version/gc-health.service";
import { GcPolicyService } from "./modules/block-version/gc-policy.service";
import { GcRunService } from "./modules/block-version/gc-run.service";
import { GcSweepService } from "./modules/block-version/gc-sweep.service";
import { GcStorageController } from "./modules/storage/gc-storage.controller";
import { GcStorageMaintenanceService } from "./modules/storage/gc-storage-maintenance.service";

function createRepositoryMock() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    save: jest.fn(),
    create: jest.fn((value) => value),
  };
}

describe("GcModule", () => {
  it("wires root GC shell and nested submodules with repository providers", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), GcModule],
    })
      .overrideProvider(getRepositoryToken(Document))
      .useValue(createRepositoryMock())
      .overrideProvider(getRepositoryToken(Block))
      .useValue(createRepositoryMock())
      .overrideProvider(getRepositoryToken(BlockVersion))
      .useValue(createRepositoryMock())
      .overrideProvider(getRepositoryToken(DocRevision))
      .useValue(createRepositoryMock())
      .overrideProvider(getRepositoryToken(DocSnapshot))
      .useValue(createRepositoryMock())
      .overrideProvider(getRepositoryToken(DocDraft))
      .useValue(createRepositoryMock())
      .overrideProvider(getRepositoryToken(GcRun))
      .useValue(createRepositoryMock())
      .overrideProvider(getRepositoryToken(GcRunCandidate))
      .useValue(createRepositoryMock())
      .overrideProvider(getRepositoryToken(GcCandidatePool))
      .useValue(createRepositoryMock())
      .overrideProvider(GcSweepService)
      .useValue({
        sweepDraftTombstones: jest.fn(),
        sweepRevisionTombstones: jest.fn(),
        sweepBlockVersions: jest.fn(),
      })
      .overrideProvider(GcStorageMaintenanceService)
      .useValue({
        compact: jest.fn(),
      })
      .overrideProvider(SystemAdminTokenGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    expect(moduleRef.get(GcModulesController)).toBeInstanceOf(GcModulesController);
    expect(moduleRef.get(GcRegistryService)).toBeInstanceOf(GcRegistryService);
    expect(moduleRef.get(GcController)).toBeInstanceOf(GcController);
    expect(moduleRef.get(GcStorageController)).toBeInstanceOf(GcStorageController);
    expect(moduleRef.get(GcPolicyService)).toBeInstanceOf(GcPolicyService);
    expect(moduleRef.get(GcHealthService)).toBeInstanceOf(GcHealthService);
    expect(moduleRef.get(BlockVersionGcCollector)).toBeInstanceOf(BlockVersionGcCollector);
    expect(moduleRef.get(GcRunService)).toBeInstanceOf(GcRunService);
    expect(moduleRef.get(GcSweepService)).toBeDefined();
    expect(moduleRef.get(GcStorageMaintenanceService)).toBeDefined();
  });
});
