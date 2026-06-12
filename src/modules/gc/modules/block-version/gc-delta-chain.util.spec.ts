import { expandDeltaChainResourceKeys } from "./gc-delta-chain.util";
import { blockVersionResourceKey } from "./gc-resource-key.util";

describe("expandDeltaChainResourceKeys", () => {
  it("extends retained keys to include the full delta chain interval", () => {
    const keys = new Set<string>(["b_1@8"]);
    expandDeltaChainResourceKeys(
      [
        { blockId: "b_1", ver: 5, payloadKind: "full", baseVer: null },
        { blockId: "b_1", ver: 6, payloadKind: "delta", baseVer: 5 },
        { blockId: "b_1", ver: 7, payloadKind: "delta", baseVer: 5 },
        { blockId: "b_1", ver: 8, payloadKind: "delta", baseVer: 5 },
      ],
      keys,
    );

    expect([...keys].sort()).toEqual(["b_1@5", "b_1@6", "b_1@7", "b_1@8"]);
  });

  it("is a no-op for full snapshots without delta metadata", () => {
    const keys = new Set<string>(["b_1@3"]);
    expandDeltaChainResourceKeys(
      [{ blockId: "b_1", ver: 3, payloadKind: "full", baseVer: null }],
      keys,
    );
    expect([...keys]).toEqual(["b_1@3"]);
  });
});
