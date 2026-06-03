import { generateVersionId } from "../../../../common/utils/id-generator.util";

export function blockVersionResourceKey(blockId: string, ver: number): string {
  return generateVersionId(blockId, ver);
}

export function parseBlockVersionResourceKey(key: string): { blockId: string; ver: number } {
  const separator = key.lastIndexOf("@");
  if (separator <= 0 || separator === key.length - 1) {
    throw new Error(`Invalid block version resource key: ${key}`);
  }

  const blockId = key.slice(0, separator);
  const ver = Number.parseInt(key.slice(separator + 1), 10);
  if (!Number.isInteger(ver) || ver <= 0) {
    throw new Error(`Invalid block version number in resource key: ${key}`);
  }

  return { blockId, ver };
}

export function snapshotMapToResourceKeys(map: Record<string, number> | null | undefined) {
  const keys = new Set<string>();
  for (const [blockId, ver] of Object.entries(map ?? {})) {
    if (typeof ver === "number" && Number.isInteger(ver) && ver > 0) {
      keys.add(blockVersionResourceKey(blockId, ver));
    }
  }
  return keys;
}
