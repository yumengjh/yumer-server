import { Injectable } from "@nestjs/common";
import type {
  BlockVersionGcCandidateAgeBucket,
  BlockVersionGcCandidateDecision,
  BlockVersionGcCandidateFacts,
  BlockVersionGcPersistedCandidate,
  BlockVersionGcPolicy,
} from "./gc.types";

const SECOND = 1000;

/**
 * 块版本 GC preview 的集中硬编码策略。
 *
 * 本地调试时建议只改这里，不要到别的文件里分散修改。
 *
 * 常见调试写法：
 * - `10 * SECOND`：几乎立刻能看到 candidate
 * - `1 * MINUTE`：适合本地短链路调试
 * - `1 * HOUR + 39 * MINUTE`：适合测试混合时长窗口
 * - `24 * HOUR`：一天保留窗口
 */
const BLOCK_VERSION_GC_POLICY: BlockVersionGcPolicy = {
  /**
   * 未被引用的块版本至少要“老”到超过这个时间窗口，才可能进入 candidate。
   *
   * 作用：
   * - 比这个窗口新的版本：直接按策略保留，不会出现在 candidates 中
   * - 比这个窗口老的版本：如果也没有 root 引用，才可能成为 candidate
   *
   * 调试时这里最常改，支持秒级、分钟级、小时级任意组合。
   */
  gracePeriodMs: 10 * SECOND,

  /**
   * 对 `payload.attrs.deleted === true` 且仍然挂在 `blockVersionMap` 里的 tombstone root，
   * 单独使用这个宽限期判断是否进入“压缩 map 引用”的候选集。
   *
   * 作用：
   * - 未超过这个窗口：继续作为 tombstone root 展示，但不进入候选
   * - 超过这个窗口：进入 `compact_map_entry` preview 候选，用来提示后续可以从 map 中移除该引用
   *
   * 这一步不会删除 `block_versions`，只是在 preview 中暴露“可以压缩 map”的信号。
   */
  tombstoneGracePeriodMs: 10 * SECOND,

  /**
   * 对未被 root 引用的 `blockId`，额外保留最近 N 个版本。
   * `blocks.latestVer` 的保护是单独成立的，不依赖这个参数。
   *
   * 作用：
   * - 值越大：越保守，candidates 越少
   * - 值越小：越激进，candidates 越容易出现
   * - 设为 `0`：关闭这层额外保留，仅依赖 root 和 `gracePeriodMs`
   *
   * 本地调试如果想尽快看到结果，建议先设成 `1`；极端激进模式可以直接设成 `0`。
   */
  keepLatestPerBlock: 0,

  /**
   * Candidate first appears in preview before it can be promoted into the executable pool.
   */
  promotionDelayMs: 10 * SECOND,

  /**
   * A candidate must be seen in consecutive preview observations at least this many times.
   */
  stableSeenThreshold: 2,

  /**
   * 单次 preview 最多把多少条 candidate 明细写入 `gc_run_candidates`。
   *
   * 作用：
   * - summary 里的总数仍然是真实总数
   * - 这里只限制“明细落库和面板展示”的最大条数
   */
  maxCandidatesToStore: 1000,

  /**
   * Reserved for future sweep batch selection.
   */
  maxSweepBatchSize: 1000,

  /**
   * Reserved for future pool pruning.
   */
  poolEntryExpireMs: 7 * 24 * 60 * 60 * SECOND,

  /**
   * 哪些显式引用源会把块版本标记为存活。
   *
   * 当前含义：
   * - `doc_snapshots`：正式提交后的文档版本
   * - `document_drafts`：当前编辑中的草稿视图
   */
  rootSources: ["doc_snapshots", "document_drafts"],
};

@Injectable()
export class GcPolicyService {
  getBlockVersionPolicy(): BlockVersionGcPolicy {
    return { ...BLOCK_VERSION_GC_POLICY };
  }

  assessBlockVersionCandidate(
    candidate: BlockVersionGcCandidateFacts,
  ): BlockVersionGcCandidateDecision {
    return this.buildDecision(candidate);
  }

  explainPersistedBlockVersionCandidate(
    candidate: BlockVersionGcPersistedCandidate,
    policy = BLOCK_VERSION_GC_POLICY,
  ): BlockVersionGcCandidateDecision {
    return this.buildDecision(this.normalizePersistedCandidate(candidate, policy));
  }

  private buildDecision(candidate: BlockVersionGcCandidateFacts): BlockVersionGcCandidateDecision {
    const reasons: string[] = [];
    const action = candidate.action;
    const isTombstoneCompaction = action === "compact_map_entry";
    const graceWindowMs = isTombstoneCompaction
      ? candidate.tombstoneGracePeriodMs
      : candidate.gracePeriodMs;

    if (isTombstoneCompaction) {
      if (candidate.ageMs >= graceWindowMs * 24) {
        reasons.push("tombstone root is old enough to compact");
      } else if (candidate.ageMs >= graceWindowMs * 4) {
        reasons.push("tombstone root is comfortably past the grace window");
      } else {
        reasons.push("tombstone root only just crossed the grace window");
      }

      if (candidate.rootSourceCount > 1) {
        reasons.push("same tombstone appears from multiple root sources");
      }

      if (candidate.retainedByPolicy) {
        reasons.push("candidate still overlaps policy retention");
      }

      if (candidate.distanceFromLatestVer <= candidate.keepLatestPerBlock) {
        reasons.push("candidate is close to the latest-version boundary");
      } else {
        reasons.push("candidate is far enough from the latest-version boundary");
      }
    } else {
      if (candidate.ageMs >= graceWindowMs * 24) {
        reasons.push("version is far beyond the grace window");
      } else if (candidate.ageMs >= graceWindowMs * 4) {
        reasons.push("version is comfortably beyond the grace window");
      } else if (candidate.ageMs >= graceWindowMs * 2) {
        reasons.push("version only barely cleared the grace window");
      } else {
        reasons.push("version is close to the grace window");
      }

      if (candidate.distanceFromLatestVer <= candidate.keepLatestPerBlock) {
        reasons.push("version is close to the latest retained versions");
      } else {
        reasons.push("version is far from the latest retained versions");
      }

      if (candidate.rootKind === "none") {
        reasons.push("version is not currently root-referenced");
      }
    }

    return {
      decision: "candidate",
      candidateClass: isTombstoneCompaction
        ? "deleted_tombstone_map_entry"
        : "unreferenced_block_version",
      decisionReasons: reasons,
    };
  }

  private normalizePersistedCandidate(
    candidate: BlockVersionGcPersistedCandidate,
    policy: BlockVersionGcPolicy,
  ): BlockVersionGcCandidateFacts {
    const reasonDetail = candidate.reasonDetail;
    const gracePeriodMs = reasonDetail.gracePeriodMs ?? policy.gracePeriodMs;
    const tombstoneGracePeriodMs =
      reasonDetail.tombstoneGracePeriodMs ?? policy.tombstoneGracePeriodMs;
    const keepLatestPerBlock = reasonDetail.keepLatestPerBlock ?? policy.keepLatestPerBlock;
    const ageMs =
      reasonDetail.ageMs ?? Math.max(0, Date.now() - Number(candidate.versionCreatedAt));
    const ageBucket = reasonDetail.ageBucket ?? this.deriveAgeBucket(ageMs, gracePeriodMs);

    return {
      reasonCode: candidate.reasonCode,
      rootKind: reasonDetail.rootKind,
      deleted: reasonDetail.deleted,
      source: reasonDetail.source,
      action: reasonDetail.action,
      hardRooted: reasonDetail.hardRooted,
      retainedByPolicy: reasonDetail.retainedByPolicy,
      versionCreatedAt: candidate.versionCreatedAt,
      ageMs,
      ageBucket,
      rootSourceCount: reasonDetail.rootSourceCount ?? 0,
      distanceFromLatestVer: reasonDetail.distanceFromLatestVer ?? 0,
      gracePeriodMs,
      tombstoneGracePeriodMs,
      keepLatestPerBlock,
      decisionPath: reasonDetail.decisionPath ?? this.defaultDecisionPath(candidate.reasonCode),
    };
  }

  private deriveAgeBucket(ageMs: number, graceWindowMs: number): BlockVersionGcCandidateAgeBucket {
    if (ageMs < graceWindowMs * 2) return "fresh";
    if (ageMs < graceWindowMs * 8) return "recent";
    return "stable";
  }

  private defaultDecisionPath(reasonCode: string): string[] {
    return reasonCode === "deleted_tombstone_map_entry"
      ? ["tombstone_root", "old_enough_for_compaction"]
      : ["unreferenced", "older_than_policy"];
  }
}
