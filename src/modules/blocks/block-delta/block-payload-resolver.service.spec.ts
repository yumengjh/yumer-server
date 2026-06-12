import { Test, TestingModule } from "@nestjs/testing";
import { BlockPayloadResolverService } from "./block-payload-resolver.service";
import { canonicalStringify, computeDelta, parseCanonicalPayload } from "./block-delta";

describe("BlockPayloadResolverService", () => {
  let service: BlockPayloadResolverService;
  const manager = {
    find: jest.fn(),
    getRepository: jest.fn(() => ({
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: manager.find,
      })),
    })),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BlockPayloadResolverService],
    }).compile();

    service = module.get(BlockPayloadResolverService);
    manager.find.mockReset();
  });

  it("returns full payloads directly", async () => {
    const payload = { type: "paragraph", content: [{ type: "text", text: "hello" }] };
    const resolved = await service.resolveBlockPayloads(manager as never, [
      {
        id: 1,
        docId: "doc_1",
        blockId: "b1",
        ver: 2,
        payloadKind: "full",
        baseVer: null,
        delta: null,
        payload,
      },
    ]);

    expect(resolved.get("doc_1:b1:2")).toEqual(payload);
    expect(manager.find).not.toHaveBeenCalled();
  });

  it("normalizes full codeBlock payloads like delta reconstruction", async () => {
    const payload = {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "hello\r\nworld" }],
    };

    const resolved = await service.resolveBlockPayloads(manager as never, [
      {
        id: 1,
        docId: "doc_1",
        blockId: "b1",
        ver: 1,
        payloadKind: "full",
        baseVer: null,
        delta: null,
        payload,
      },
    ]);

    expect(resolved.get("doc_1:b1:1")).toEqual(
      parseCanonicalPayload(canonicalStringify(payload)),
    );
    expect(manager.find).not.toHaveBeenCalled();
  });

  it("reconstructs delta chains", async () => {
    const basePayload = {
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [{ type: "text", text: "a".repeat(9000) }],
    };
    const nextPayload = {
      ...basePayload,
      content: [{ type: "text", text: `${"a".repeat(9000)}b` }],
    };
    const patch = computeDelta(basePayload, nextPayload);

    manager.find.mockResolvedValue([
      {
        id: 1,
        docId: "doc_1",
        blockId: "b1",
        ver: 1,
        payloadKind: "full",
        baseVer: null,
        delta: null,
        payload: basePayload,
      },
      {
        id: 2,
        docId: "doc_1",
        blockId: "b1",
        ver: 2,
        payloadKind: "delta",
        baseVer: 1,
        delta: patch,
        payload: null,
      },
    ]);

    const resolved = await service.resolveBlockPayloads(manager as never, [
      {
        id: 2,
        docId: "doc_1",
        blockId: "b1",
        ver: 2,
        payloadKind: "delta",
        baseVer: 1,
        delta: patch,
        payload: null,
      },
    ]);

    expect(resolved.get("doc_1:b1:2")).toEqual(
      parseCanonicalPayload(canonicalStringify(nextPayload)),
    );
  });

  it("reconstructs three-step delta chains from the full base", async () => {
    const basePayload = {
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [{ type: "text", text: "a".repeat(9000) }],
    };
    const secondPayload = {
      ...basePayload,
      content: [{ type: "text", text: `${"a".repeat(9000)}b` }],
    };
    const thirdPayload = {
      ...basePayload,
      content: [{ type: "text", text: `${"a".repeat(9000)}bc` }],
    };
    const fourthPayload = {
      ...basePayload,
      content: [{ type: "text", text: `${"a".repeat(9000)}bcd` }],
    };

    const patch2 = computeDelta(basePayload, secondPayload);
    const patch3 = computeDelta(secondPayload, thirdPayload);
    const patch4 = computeDelta(thirdPayload, fourthPayload);

    manager.find.mockResolvedValue([
      {
        id: 1,
        docId: "doc_1",
        blockId: "b1",
        ver: 1,
        payloadKind: "full",
        baseVer: null,
        delta: null,
        payload: basePayload,
      },
      {
        id: 2,
        docId: "doc_1",
        blockId: "b1",
        ver: 2,
        payloadKind: "delta",
        baseVer: 1,
        delta: patch2,
        payload: null,
      },
      {
        id: 3,
        docId: "doc_1",
        blockId: "b1",
        ver: 3,
        payloadKind: "delta",
        baseVer: 1,
        delta: patch3,
        payload: null,
      },
      {
        id: 4,
        docId: "doc_1",
        blockId: "b1",
        ver: 4,
        payloadKind: "delta",
        baseVer: 1,
        delta: patch4,
        payload: null,
      },
    ]);

    const resolved = await service.resolveBlockPayloads(manager as never, [
      {
        id: 4,
        docId: "doc_1",
        blockId: "b1",
        ver: 4,
        payloadKind: "delta",
        baseVer: 1,
        delta: patch4,
        payload: null,
      },
    ]);

    expect(resolved.get("doc_1:b1:4")).toEqual(
      parseCanonicalPayload(canonicalStringify(fourthPayload)),
    );
  });
});
