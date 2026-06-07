import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { DiscardDraftDto } from "./discard-draft.dto";

describe("DiscardDraftDto validation", () => {
  it("allows sync session mirror fields under whitelist validation", async () => {
    const dto = plainToInstance(DiscardDraftDto, {
      sessionId: "session_1",
      sessionEpoch: 2,
      leaseExpiresAt: "2026-06-04T23:30:00.000Z",
      lastAckedOpSeq: 42,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toEqual([]);
  });

  it("allows null lastAckedOpSeq under whitelist validation", async () => {
    const dto = plainToInstance(DiscardDraftDto, {
      sessionId: "session_1",
      sessionEpoch: 2,
      leaseExpiresAt: "2026-06-04T23:30:00.000Z",
      lastAckedOpSeq: null,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toEqual([]);
  });
});
