import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { BatchBlockDto, BatchOperationType } from "./batch-block.dto";

describe("BatchBlockDto", () => {
  const pipeOptions = {
    whitelist: true,
    forbidNonWhitelisted: true,
  };

  it("accepts batch update operations with delta data", async () => {
    const dto = plainToInstance(BatchBlockDto, {
      docId: "doc_1",
      baseVersion: 1,
      clientBatchId: "batch_delta_1",
      operations: [
        {
          type: BatchOperationType.UPDATE,
          blockId: "block_1",
          data: {
            delta: {
              format: "dmp-v1",
              baseVer: 2,
              baseHash: "a".repeat(64),
              patch: "@@ -1,1 +1,2 @@\n+x",
              resultHash: "b".repeat(64),
            },
          },
        },
      ],
    });

    const errors = await validate(dto, pipeOptions);
    expect(errors).toEqual([]);
  });
});
