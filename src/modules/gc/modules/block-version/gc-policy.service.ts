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
   * 候选项首次出现在 preview 后，还要再等多久，才允许进入可执行池。
   *
   * 作用：
   * - 避免刚出现一次的抖动候选立刻进入 sweep
   * - 即使命中了候选，也至少要等这个时间过去
   */
  promotionDelayMs: 10 * SECOND,

  /**
   * 同一个 candidate 至少要连续出现多少次 preview，才算“稳定出现”。
   *
   * 作用：
   * - 值越大：越保守，必须多次重复观察到才进入 eligible
   * - 值越小：越激进，更快进入可执行池
   */
  stableSeenThreshold: 1,

  /**
   * 单次 preview 最多把多少条 candidate 明细写入 `gc_run_candidates`。
   *
   * 作用：
   * - summary 里的总数仍然是真实总数
   * - 这里只限制“明细落库和面板展示”的最大条数
   */
  maxCandidatesToStore: 1000,

  /**
   * sweep 阶段单次最多处理多少条候选。
   *
   * 当前主要用于批次上限控制，避免一次 sweep 处理过多。
   */
  maxSweepBatchSize: 1000,

  /**
   * pool 中候选项的过期时间。
   *
   * 当前代码还没有真正用它去清理 pool，但它表达的是：
   * - 候选项在池里最多允许保留多久
   * - 后续如果做 pool 清理，会按这个窗口淘汰陈旧项
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
        reasons.push("墓碑 root 已经足够老，可以压缩 map 引用");
      } else if (candidate.ageMs >= graceWindowMs * 4) {
        reasons.push("墓碑 root 已明显超过压缩宽限期");
      } else {
        reasons.push("墓碑 root 刚刚超过压缩宽限期");
      }

      if (candidate.rootSourceCount > 1) {
        reasons.push("同一个墓碑版本同时出现在多个 root 引用源中");
      }

      if (candidate.retainedByPolicy) {
        reasons.push("该候选仍与策略保留窗口重叠");
      }

      if (candidate.distanceFromLatestVer <= candidate.keepLatestPerBlock) {
        reasons.push("该候选距离最新版本边界较近");
      } else {
        reasons.push("该候选距离最新版本边界已经足够远");
      }
    } else {
      if (candidate.ageMs >= graceWindowMs * 24) {
        reasons.push("该版本已经远远超过保留时间窗口");
      } else if (candidate.ageMs >= graceWindowMs * 4) {
        reasons.push("该版本已经明显超过保留时间窗口");
      } else if (candidate.ageMs >= graceWindowMs * 2) {
        reasons.push("该版本只是刚刚越过保留时间窗口");
      } else {
        reasons.push("该版本仍然贴近保留时间窗口");
      }

      if (candidate.distanceFromLatestVer <= candidate.keepLatestPerBlock) {
        reasons.push("该版本距离最近保留版本较近");
      } else {
        reasons.push("该版本距离最近保留版本已经足够远");
      }

      if (candidate.rootKind === "none") {
        reasons.push("该版本当前没有被任何 root 引用");
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
