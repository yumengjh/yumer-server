import {
  blockVersionResourceKey,
  parseBlockVersionResourceKey,
  snapshotMapToResourceKeys,
} from "./gc-resource-key.util";

describe("GC resource key helpers", () => {
  it("uses blockId@ver as the canonical block version key", () => {
    expect(blockVersionResourceKey("b_1", 7)).toBe("b_1@7");
  });

  it("parses a block version resource key", () => {
    expect(parseBlockVersionResourceKey("b_1@7")).toEqual({ blockId: "b_1", ver: 7 });
  });

  it("converts a snapshot map into canonical resource keys", () => {
    expect(snapshotMapToResourceKeys({ root_1: 1, b_1: 3 })).toEqual(
      new Set(["root_1@1", "b_1@3"]),
    );
  });
});
