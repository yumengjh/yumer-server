import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyDelta,
  buildBlockDelta,
  canonicalStringify,
  computeDelta,
  ensurePayloadType,
  hashPayloadCanonical,
  parseCanonicalPayload,
  shouldAcceptClientDelta,
  shouldStoreDelta,
} from "./block-delta";
import { DELTA_REFERENCE_LARGE_BLOCK_BYTES } from "./delta-policy";

type DeltaFixture = {
  name: string;
  base: Record<string, unknown>;
  next: Record<string, unknown>;
  baseHash: string;
  nextHash: string;
};

const fixturesPath = join(__dirname, "__fixtures__", "delta-fixtures.json");
const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8")) as DeltaFixture[];

describe("block delta", () => {
  it("canonicalStringify strips sync attrs and sorts keys", () => {
    const canonical = canonicalStringify({
      type: "paragraph",
      attrs: { sortKey: "a0", blockId: "b1", textAlign: "left" },
      content: [{ type: "text", text: "hello" }],
    });

    expect(canonical).toBe(
      JSON.stringify({
        attrs: { textAlign: "left" },
        content: [{ text: "hello", type: "text" }],
        type: "paragraph",
      }),
    );
  });

  it("is stable regardless of input key order", () => {
    const left = canonicalStringify({ b: 2, a: { z: 1, y: 2 } });
    const right = canonicalStringify({ a: { y: 2, z: 1 }, b: 2 });
    expect(left).toBe(right);
  });

  for (const fixture of fixtures) {
    it(`roundtrips fixture: ${fixture.name}`, () => {
      const patch = computeDelta(fixture.base, fixture.next);
      const appliedText = applyDelta(fixture.base, patch);
      const appliedPayload = parseCanonicalPayload(appliedText);
      const expectedCanonical = canonicalStringify(fixture.next);

      expect(appliedText).toBe(expectedCanonical);
      expect(canonicalStringify(appliedPayload)).toBe(expectedCanonical);

      const delta = buildBlockDelta({
        basePayload: fixture.base,
        nextPayload: fixture.next,
        baseVer: 3,
      });
      expect(delta.format).toBe("dmp-v1");
      expect(delta.baseVer).toBe(3);
      expect(delta.baseHash).toBe(hashPayloadCanonical(fixture.base));
      expect(delta.resultHash).toBe(hashPayloadCanonical(fixture.next));
    });

    it(`matches golden hashes: ${fixture.name}`, () => {
      expect(hashPayloadCanonical(fixture.base)).toBe(fixture.baseHash);
      expect(hashPayloadCanonical(fixture.next)).toBe(fixture.nextHash);
    });
  }

  it("decides storage delta by size threshold, ratio, and chain limit", () => {
    const smallBase = { type: "paragraph", content: [{ type: "text", text: "a" }] };
    const smallNext = { type: "paragraph", content: [{ type: "text", text: "ab" }] };
    expect(
      shouldStoreDelta({
        fullPayload: smallNext,
        basePayload: smallBase,
        chainLength: 0,
      }),
    ).toBe(false);

    const largeText = "x".repeat(DELTA_REFERENCE_LARGE_BLOCK_BYTES);
    const largeBase = { type: "codeBlock", content: [{ type: "text", text: largeText }] };
    const largeNext = {
      type: "codeBlock",
      content: [{ type: "text", text: `${largeText}y` }],
    };
    expect(
      shouldStoreDelta({
        fullPayload: largeNext,
        basePayload: largeBase,
        chainLength: 0,
      }),
    ).toBe(true);
    expect(
      shouldStoreDelta({
        fullPayload: largeNext,
        basePayload: largeBase,
        chainLength: 12,
      }),
    ).toBe(false);
  });

  it("accepts client delta when DB payload lacks top-level type", () => {
    const baseWithoutType = {
      attrs: { language: "javascript" },
      content: [{ type: "text", text: "hello\r\nworld" }],
    };
    const baseWithType = ensurePayloadType(baseWithoutType, "codeBlock");
    const nextWithType = {
      type: "codeBlock",
      attrs: { language: "javascript" },
      content: [{ type: "text", text: "hello\r\nworld!" }],
    };
    const delta = buildBlockDelta({
      basePayload: baseWithType,
      nextPayload: nextWithType,
      baseVer: 1,
      blockType: "codeBlock",
    });

    const accepted = shouldAcceptClientDelta({
      basePayload: baseWithoutType,
      delta,
      blockType: "codeBlock",
    });
    expect(accepted.ok).toBe(true);
  });

  it("rejects client delta when the patched result hash does not match", () => {
    const basePayload = {
      type: "paragraph",
      content: [{ type: "text", text: "hello" }],
    };
    const nextPayload = {
      type: "paragraph",
      content: [{ type: "text", text: "hello world" }],
    };
    const delta = buildBlockDelta({
      basePayload,
      nextPayload,
      baseVer: 1,
    });

    const accepted = shouldAcceptClientDelta({
      basePayload,
      delta: {
        ...delta,
        resultHash: "0".repeat(64),
      },
    });

    expect(accepted).toEqual({ ok: false, reason: "DELTA_RESULT_MISMATCH" });
  });

  it("normalizes CRLF in text nodes for stable hashes", () => {
    const lf = canonicalStringify({
      type: "codeBlock",
      content: [{ type: "text", text: "a\nb" }],
    });
    const crlf = canonicalStringify({
      type: "codeBlock",
      content: [{ type: "text", text: "a\r\nb" }],
    });
    expect(lf).toBe(crlf);
  });
});
