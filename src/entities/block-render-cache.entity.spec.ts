import { getMetadataArgsStorage } from "typeorm";
import { BlockRenderCache } from "./block-render-cache.entity";

describe("BlockRenderCache entity", () => {
  it("为 status 显式声明 varchar 类型以兼容 SQLite", () => {
    const statusColumn = getMetadataArgsStorage().columns.find(
      (column) => column.target === BlockRenderCache && column.propertyName === "status",
    );

    expect(statusColumn?.options.type).toBe("varchar");
  });
});
