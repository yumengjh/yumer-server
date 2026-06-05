import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { DraftCheckpointDto } from "./draft-checkpoint.dto";

describe("DraftCheckpointDto validation", () => {
  it("allows block payload under whitelist validation", async () => {
    const dto = plainToInstance(DraftCheckpointDto, {
      mode: "checkpoint",
      coverage: "full",
      clientCheckpointId: "checkpoint_1",
      clientId: "client_1",
      baseVersion: 1,
      draftRevision: 2,
      sessionId: "session_1",
      sessionEpoch: 1,
      contentHash: "sha256:abc",
      generatedAt: 1782900000000,
      rootBlockId: "root_1",
      blocks: [
        {
          clientId: "block_client_1",
          type: "paragraph",
          orderKey: "001000",
          payload: {
            type: "paragraph",
            attrs: { textAlign: "left" },
            content: [{ type: "text", text: "hello" }],
          },
          plainText: "hello",
        },
      ],
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toEqual([]);
  });
});
