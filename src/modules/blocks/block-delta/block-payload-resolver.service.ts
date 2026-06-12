import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { BlockVersion } from "../../../entities/block-version.entity";
import { applyDelta, canonicalStringify, ensurePayloadType, parseCanonicalPayload } from "./block-delta";

type VersionRef = Pick<
  BlockVersion,
  "id" | "docId" | "blockId" | "ver" | "payloadKind" | "baseVer" | "delta" | "payload"
>;

@Injectable()
export class BlockPayloadResolverService {
  private readonly cache = new Map<string, object>();
  private readonly cacheOrder: string[] = [];
  private readonly maxCacheSize = 512;

  async resolveBlockPayloads(
    manager: EntityManager,
    versions: VersionRef[],
  ): Promise<Map<string, object>> {
    const resolved = new Map<string, object>();
    const pendingDelta: VersionRef[] = [];

    for (const version of versions) {
      const key = this.versionKey(version);
      const cached = this.cache.get(key);
      if (cached) {
        resolved.set(key, cached);
        continue;
      }

      if (this.isFullVersion(version)) {
        const payload = this.normalizeResolvedPayload(version.payload);
        resolved.set(key, payload);
        this.remember(key, payload);
        continue;
      }

      pendingDelta.push(version);
    }

    if (pendingDelta.length === 0) {
      return resolved;
    }

    const chainRowsByBlock = await this.loadChainRows(manager, pendingDelta);
    for (const version of pendingDelta) {
      const key = this.versionKey(version);
      if (resolved.has(key)) continue;

      const payload = this.resolveFromChain(version, chainRowsByBlock.get(version.blockId) ?? []);
      resolved.set(key, payload);
      this.remember(key, payload);
    }

    return resolved;
  }

  async resolveBlockPayload(
    manager: EntityManager,
    version: VersionRef,
  ): Promise<object> {
    const resolved = await this.resolveBlockPayloads(manager, [version]);
    const payload = resolved.get(this.versionKey(version));
    if (!payload) {
      throw new Error(`Unable to resolve payload for block ${version.blockId}@${version.ver}`);
    }
    return payload;
  }

  countDeltaChainLength(version: VersionRef, chainRows: VersionRef[]): number {
    if (this.isFullVersion(version)) return 0;
    const baseVer = version.baseVer;
    if (baseVer == null) return 0;
    return chainRows.filter((row) => row.ver > baseVer && row.ver <= version.ver).length;
  }

  findChainBaseVer(version: VersionRef): number {
    if (this.isFullVersion(version)) return version.ver;
    return version.baseVer ?? version.ver;
  }

  private isFullVersion(version: VersionRef): boolean {
    if (version.payloadKind === "delta") return false;
    return version.payload != null;
  }

  private versionKey(version: Pick<BlockVersion, "docId" | "blockId" | "ver">): string {
    return `${version.docId}:${version.blockId}:${version.ver}`;
  }

  private remember(key: string, payload: object): void {
    if (this.cache.has(key)) {
      this.cache.set(key, payload);
      return;
    }
    this.cache.set(key, payload);
    this.cacheOrder.push(key);
    if (this.cacheOrder.length > this.maxCacheSize) {
      const evicted = this.cacheOrder.shift();
      if (evicted) this.cache.delete(evicted);
    }
  }

  private async loadChainRows(
    manager: EntityManager,
    versions: VersionRef[],
  ): Promise<Map<string, VersionRef[]>> {
    const rangesByBlock = new Map<string, { docId: string; minVer: number; maxVer: number }>();

    for (const version of versions) {
      const baseVer = version.baseVer ?? version.ver;
      const current = rangesByBlock.get(version.blockId);
      if (!current) {
        rangesByBlock.set(version.blockId, {
          docId: version.docId,
          minVer: baseVer,
          maxVer: version.ver,
        });
        continue;
      }
      current.minVer = Math.min(current.minVer, baseVer);
      current.maxVer = Math.max(current.maxVer, version.ver);
    }

    const chainRowsByBlock = new Map<string, VersionRef[]>();
    for (const [blockId, range] of rangesByBlock.entries()) {
      const rows = await manager
        .getRepository(BlockVersion)
        .createQueryBuilder("bv")
        .select([
          "bv.id",
          "bv.docId",
          "bv.blockId",
          "bv.ver",
          "bv.payloadKind",
          "bv.baseVer",
          "bv.delta",
          "bv.payload",
        ])
        .where("bv.docId = :docId", { docId: range.docId })
        .andWhere("bv.blockId = :blockId", { blockId })
        .andWhere("bv.ver BETWEEN :minVer AND :maxVer", {
          minVer: range.minVer,
          maxVer: range.maxVer,
        })
        .orderBy("bv.ver", "ASC")
        .getMany();
      chainRowsByBlock.set(blockId, rows);
    }

    return chainRowsByBlock;
  }

  private resolveFromChain(version: VersionRef, chainRows: VersionRef[]): object {
    const baseVer = version.baseVer;
    if (baseVer == null) {
      throw new Error(`Delta version ${version.blockId}@${version.ver} is missing baseVer`);
    }

    const baseRow = chainRows.find((row) => row.ver === baseVer);
    if (!baseRow || !this.isFullVersion(baseRow)) {
      throw new Error(`Missing full base snapshot at ${version.blockId}@${baseVer}`);
    }

    const basePayload = ensurePayloadType(
      baseRow.payload,
      (baseRow.payload as Record<string, unknown> | undefined)?.type as string | undefined,
    );
    let currentPayload: unknown = basePayload;
    const deltaRows = chainRows.filter((row) => row.ver > baseVer && row.ver <= version.ver);
    for (const row of deltaRows) {
      if (!row.delta) {
        throw new Error(`Missing delta patch at ${row.blockId}@${row.ver}`);
      }
      const canonicalText = applyDelta(
        currentPayload,
        row.delta,
        (currentPayload as Record<string, unknown> | undefined)?.type as string | undefined,
      );
      currentPayload = parseCanonicalPayload(canonicalText);
    }

    return currentPayload as object;
  }

  private normalizeResolvedPayload(payload: unknown): object {
    const typedPayload = ensurePayloadType(
      payload,
      (payload as Record<string, unknown> | undefined)?.type as string | undefined,
    );
    return parseCanonicalPayload(canonicalStringify(typedPayload)) as object;
  }
}
