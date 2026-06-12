import { BlockVersion } from "../../../../entities/block-version.entity";
import { blockVersionResourceKey } from "./gc-resource-key.util";

type DeltaChainVersion = Pick<BlockVersion, "blockId" | "ver" | "payloadKind" | "baseVer">;

/** delta 行被引用时，保护 [baseVer..ver] 整条链上的版本不被 GC。 */
export function expandDeltaChainResourceKeys(
  blockVersions: DeltaChainVersion[],
  keys: Set<string>,
): void {
  const versionByKey = new Map(
    blockVersions.map((version) => [
      blockVersionResourceKey(version.blockId, version.ver),
      version,
    ]),
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const key of keys) {
      const version = versionByKey.get(key);
      if (!version || version.payloadKind !== "delta" || version.baseVer == null) {
        continue;
      }
      for (let ver = version.baseVer; ver <= version.ver; ver += 1) {
        const chainKey = blockVersionResourceKey(version.blockId, ver);
        if (!keys.has(chainKey)) {
          keys.add(chainKey);
          changed = true;
        }
      }
    }
  }
}
