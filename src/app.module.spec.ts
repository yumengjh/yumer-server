import { BlockRenderCache } from "./entities/block-render-cache.entity";
import { GcRun } from "./entities/gc-run.entity";
import { GcRunCandidate } from "./entities/gc-run-candidate.entity";
import { databaseEntities } from "./app.module";

describe("AppModule database entities", () => {
  it("includes BlockRenderCache so document render cache repositories have metadata", () => {
    expect(databaseEntities).toContain(BlockRenderCache);
  });

  it("registers GC entities at the TypeORM root", () => {
    expect(databaseEntities).toContain(GcRun);
    expect(databaseEntities).toContain(GcRunCandidate);
  });
});
