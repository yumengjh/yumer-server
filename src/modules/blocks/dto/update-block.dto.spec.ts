import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateBlockDto } from "./update-block.dto";

describe("UpdateBlockDto", () => {
  const pipeOptions = {
    whitelist: true,
    forbidNonWhitelisted: true,
  };

  it("accepts delta-only updates under whitelist validation", async () => {
    const dto = plainToInstance(UpdateBlockDto, {
      delta: {
        format: "dmp-v1",
        baseVer: 3,
        baseHash: "a".repeat(64),
        patch: "@@ -1,1 +1,2 @@\n+x",
        resultHash: "b".repeat(64),
      },
    });

    const errors = await validate(dto, pipeOptions);
    expect(errors).toEqual([]);
  });

  it("accepts payload-only updates under whitelist validation", async () => {
    const dto = plainToInstance(UpdateBlockDto, {
      payload: { type: "paragraph", content: [{ type: "text", text: "hello" }] },
    });

    const errors = await validate(dto, pipeOptions);
    expect(errors).toEqual([]);
  });
});
