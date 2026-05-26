import { BlockRenderCache } from "./entities/block-render-cache.entity";
import { databaseEntities } from "./app.module";

describe("AppModule database entities", () => {
  it("includes BlockRenderCache so document render cache repositories have metadata", () => {
    expect(databaseEntities).toContain(BlockRenderCache);
  });
});
