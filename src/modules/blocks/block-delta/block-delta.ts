import { createHash } from "node:crypto";
import DiffMatchPatch from "diff-match-patch";
import {
  COMPACTION_CHAIN_LIMIT,
  DELTA_FORMAT,
  DELTA_MAX_RATIO,
  DELTA_MIN_FULL_SIZE,
} from "./delta-policy";
import { normalizeSyncCodeBlockAttrs } from "./sync-code-block-attrs";

export {
  COMPACTION_CHAIN_LIMIT,
  DELTA_FORMAT,
  DELTA_MAX_RATIO,
  DELTA_MIN_FULL_SIZE,
} from "./delta-policy";

export type DeltaFormat = typeof DELTA_FORMAT;
export type PayloadKind = "full" | "delta";

export interface BlockDeltaInput {
  format: DeltaFormat;
  baseVer: number;
  baseHash: string;
  patch: string;
  resultHash: string;
}

const SYNC_ATTR_KEYS = [
  "blockId",
  "clientId",
  "sortKey",
  "syncCreateId",
  "clientBatchId",
  "data-block-id",
  "data-client-id",
  "data-sort-key",
  "data-sync-create-id",
] as const;

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function ensurePayloadType(
  payload: unknown,
  blockType?: string | null,
): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.type === "string" && record.type.trim()) {
    return record;
  }
  if (typeof blockType === "string" && blockType.trim()) {
    return { ...record, type: blockType };
  }
  return record;
}

function normalizePayload(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "string") return normalizeLineEndings(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizePayload);

  const raw = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw).sort((a, b) => a.localeCompare(b))) {
    const next = normalizePayload(raw[key]);
    if (next === undefined) continue;
    out[key] = next;
  }

  if (out.attrs && typeof out.attrs === "object" && !Array.isArray(out.attrs)) {
    const attrs = { ...(out.attrs as Record<string, unknown>) };
    for (const key of SYNC_ATTR_KEYS) {
      delete attrs[key];
    }
    out.attrs = attrs;
  }

  const payloadType = typeof out.type === "string" ? out.type : undefined;
  if (payloadType === "codeBlock" && out.attrs && typeof out.attrs === "object" && !Array.isArray(out.attrs)) {
    out.attrs = normalizeSyncCodeBlockAttrs(out.attrs as Record<string, unknown>);
  }

  return out;
}

function canonicalizeForDelta(payload: unknown, blockType?: string | null): unknown {
  return ensurePayloadType(payload, blockType);
}

export function canonicalStringify(payload: unknown): string {
  return JSON.stringify(normalizePayload(payload));
}

export function canonicalPayloadSize(payload: unknown): number {
  return Buffer.byteLength(canonicalStringify(payload), "utf8");
}

export function hashPayloadCanonical(payload: unknown): string {
  return createHash("sha256").update(canonicalStringify(payload)).digest("hex");
}

export function computeDelta(
  basePayload: unknown,
  nextPayload: unknown,
  blockType?: string | null,
): string {
  const dmp = new DiffMatchPatch();
  const baseText = canonicalStringify(canonicalizeForDelta(basePayload, blockType));
  const nextText = canonicalStringify(canonicalizeForDelta(nextPayload, blockType));
  const patches = dmp.patch_make(baseText, nextText);
  return dmp.patch_toText(patches);
}

export function applyDelta(
  basePayload: unknown,
  patch: string,
  blockType?: string | null,
): string {
  const dmp = new DiffMatchPatch();
  const baseText = canonicalStringify(canonicalizeForDelta(basePayload, blockType));
  const patches = dmp.patch_fromText(patch);
  const [resultText, results] = dmp.patch_apply(patches, baseText);
  if (results.some((applied) => !applied)) {
    throw new Error("Failed to apply delta patch");
  }
  return resultText;
}

export function parseCanonicalPayload(canonicalText: string): unknown {
  return JSON.parse(canonicalText) as unknown;
}

export function buildBlockDelta(input: {
  basePayload: unknown;
  nextPayload: unknown;
  baseVer: number;
  blockType?: string | null;
}): BlockDeltaInput {
  const basePayload = canonicalizeForDelta(input.basePayload, input.blockType);
  const nextPayload = canonicalizeForDelta(input.nextPayload, input.blockType);
  const patch = computeDelta(basePayload, nextPayload, input.blockType);
  return {
    format: DELTA_FORMAT,
    baseVer: input.baseVer,
    baseHash: hashPayloadCanonical(basePayload),
    patch,
    resultHash: hashPayloadCanonical(nextPayload),
  };
}

export function shouldStoreDelta(input: {
  fullPayload: unknown;
  basePayload: unknown;
  chainLength: number;
  minFullSize?: number;
  maxRatio?: number;
  chainLimit?: number;
}): boolean {
  const minFullSize = input.minFullSize ?? DELTA_MIN_FULL_SIZE;
  const maxRatio = input.maxRatio ?? DELTA_MAX_RATIO;
  const chainLimit = input.chainLimit ?? COMPACTION_CHAIN_LIMIT;
  const fullSize = canonicalPayloadSize(input.fullPayload);
  if (fullSize < minFullSize) return false;
  if (input.chainLength >= chainLimit) return false;

  const patch = computeDelta(input.basePayload, input.fullPayload);
  if (patch.length === 0) return false;
  const patchSize = Buffer.byteLength(patch, "utf8");
  return patchSize <= fullSize * maxRatio;
}

export function shouldAcceptClientDelta(input: {
  basePayload: unknown;
  delta: BlockDeltaInput;
  blockType?: string | null;
}): { ok: true; canonicalText: string } | { ok: false; reason: "DELTA_BASE_MISMATCH" | "DELTA_RESULT_MISMATCH" } {
  const canonicalBase = canonicalizeForDelta(input.basePayload, input.blockType);
  const baseHash = hashPayloadCanonical(canonicalBase);
  if (baseHash !== input.delta.baseHash) {
    return { ok: false, reason: "DELTA_BASE_MISMATCH" };
  }

  let canonicalText: string;
  try {
    canonicalText = applyDelta(canonicalBase, input.delta.patch, input.blockType);
  } catch {
    return { ok: false, reason: "DELTA_BASE_MISMATCH" };
  }

  const resultHash = hashPayloadCanonical(parseCanonicalPayload(canonicalText));
  if (resultHash !== input.delta.resultHash) {
    return { ok: false, reason: "DELTA_RESULT_MISMATCH" };
  }

  return { ok: true, canonicalText };
}
