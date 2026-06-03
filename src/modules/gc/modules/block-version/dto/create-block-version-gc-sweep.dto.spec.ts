import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { CreateBlockVersionGcSweepDto } from "./create-block-version-gc-sweep.dto";

describe("CreateBlockVersionGcSweepDto", () => {
  it("accepts limit=10000", () => {
    const dto = plainToInstance(CreateBlockVersionGcSweepDto, {
      workspaceId: "ws_1",
      limit: 10_000,
      dryRun: true,
    });

    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
  });

  it("rejects limit greater than 10000", () => {
    const dto = plainToInstance(CreateBlockVersionGcSweepDto, {
      limit: 10_001,
    });

    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toMatchObject({
      max: "limit must not be greater than 10000",
    });
  });
});
