import { Injectable } from "@nestjs/common";
import type {
  BlockVersionGcCandidateAgeBucket,
  BlockVersionGcCandidateExplainability,
  BlockVersionGcCandidateFacts,
  BlockVersionGcPersistedCandidate,
  BlockVersionGcPolicy,
  BlockVersionGcRiskAssessment,
  BlockVersionGcRiskFactor,
} from "./gc.types";

const SECOND = 1000;
const LOW_RISK_THRESHOLD = 33;
const MEDIUM_RISK_THRESHOLD = 66;

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
   * 单次 preview 最多把多少条 candidate 明细写入 `gc_run_candidates`。
   *
   * 作用：
   * - summary 里的总数仍然是真实总数
   * - 这里只限制“明细落库和面板展示”的最大条数
   */
  maxCandidatesToStore: 1000,

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
  ): BlockVersionGcCandidateExplainability {
    return this.buildExplainability(candidate);
  }

  explainPersistedBlockVersionCandidate(
    candidate: BlockVersionGcPersistedCandidate,
    policy = BLOCK_VERSION_GC_POLICY,
  ): BlockVersionGcCandidateExplainability {
    return this.buildExplainability(this.normalizePersistedCandidate(candidate, policy));
  }

  private buildExplainability(
    candidate: BlockVersionGcCandidateFacts,
  ): BlockVersionGcCandidateExplainability {
    const factors: BlockVersionGcRiskFactor[] = [];
    const reasons: string[] = [];
    const action = candidate.action;
    const isTombstoneCompaction = action === "compact_map_entry";
    const graceWindowMs = isTombstoneCompaction
      ? candidate.tombstoneGracePeriodMs
      : candidate.gracePeriodMs;
    let score = isTombstoneCompaction ? 24 : 52;

    if (isTombstoneCompaction) {
      this.addFactor(
        factors,
        reasons,
        "metadata_only_action",
        -8,
        { action },
        "candidate only compacts a tombstone map entry",
      );

      if (candidate.ageMs >= graceWindowMs * 24) {
        this.addFactor(
          factors,
          reasons,
          "tombstone_age_stable",
          -20,
          { ageMs: candidate.ageMs, graceWindowMs },
          "tombstone root is old enough to compact",
        );
      } else if (candidate.ageMs >= graceWindowMs * 4) {
        this.addFactor(
          factors,
          reasons,
          "tombstone_age_old",
          -10,
          { ageMs: candidate.ageMs, graceWindowMs },
          "tombstone root is comfortably past the grace window",
        );
      } else {
        this.addFactor(
          factors,
          reasons,
          "tombstone_age_fresh",
          24,
          { ageMs: candidate.ageMs, graceWindowMs },
          "tombstone root only just crossed the grace window",
        );
      }

      if (candidate.rootSourceCount > 1) {
        this.addFactor(
          factors,
          reasons,
          "root_source_ambiguity",
          18,
          { rootSourceCount: candidate.rootSourceCount },
          "same tombstone appears from multiple root sources",
        );
      }

      if (candidate.retainedByPolicy) {
        this.addFactor(
          factors,
          reasons,
          "policy_overlap",
          14,
          {
            retainedByPolicy: candidate.retainedByPolicy,
            keepLatestPerBlock: candidate.keepLatestPerBlock,
          },
          "candidate still overlaps policy retention",
        );
      }

      if (candidate.distanceFromLatestVer <= candidate.keepLatestPerBlock) {
        this.addFactor(
          factors,
          reasons,
          "latest_boundary",
          10,
          {
            distanceFromLatestVer: candidate.distanceFromLatestVer,
            keepLatestPerBlock: candidate.keepLatestPerBlock,
          },
          "candidate is close to the latest-version boundary",
        );
      } else {
        this.addFactor(
          factors,
          reasons,
          "latest_distance_bonus",
          -4,
          {
            distanceFromLatestVer: candidate.distanceFromLatestVer,
            keepLatestPerBlock: candidate.keepLatestPerBlock,
          },
          "candidate is far enough from the latest-version boundary",
        );
      }
    } else {
      this.addFactor(
        factors,
        reasons,
        "unreferenced_cleanup_action",
        -4,
        { action },
        "candidate is a regular block-version cleanup target",
      );

      if (candidate.ageMs >= graceWindowMs * 24) {
        this.addFactor(
          factors,
          reasons,
          "far_beyond_grace",
          -22,
          { ageMs: candidate.ageMs, graceWindowMs },
          "version is far beyond the grace window",
        );
      } else if (candidate.ageMs >= graceWindowMs * 4) {
        this.addFactor(
          factors,
          reasons,
          "well_beyond_grace",
          -12,
          { ageMs: candidate.ageMs, graceWindowMs },
          "version is comfortably beyond the grace window",
        );
      } else if (candidate.ageMs >= graceWindowMs * 2) {
        this.addFactor(
          factors,
          reasons,
          "just_beyond_grace",
          14,
          { ageMs: candidate.ageMs, graceWindowMs },
          "version only barely cleared the grace window",
        );
      } else {
        this.addFactor(
          factors,
          reasons,
          "near_grace_boundary",
          28,
          { ageMs: candidate.ageMs, graceWindowMs },
          "version is close to the grace window",
        );
      }

      if (candidate.distanceFromLatestVer <= candidate.keepLatestPerBlock) {
        this.addFactor(
          factors,
          reasons,
          "near_latest_boundary",
          18,
          {
            distanceFromLatestVer: candidate.distanceFromLatestVer,
            keepLatestPerBlock: candidate.keepLatestPerBlock,
          },
          "version is close to the latest retained versions",
        );
      } else {
        this.addFactor(
          factors,
          reasons,
          "well_past_latest_boundary",
          -10,
          {
            distanceFromLatestVer: candidate.distanceFromLatestVer,
            keepLatestPerBlock: candidate.keepLatestPerBlock,
          },
          "version is far from the latest retained versions",
        );
      }

      if (candidate.rootKind === "none") {
        this.addFactor(
          factors,
          reasons,
          "no_active_root",
          -8,
          { rootKind: candidate.rootKind },
          "version is not currently root-referenced",
        );
      }
    }

    score = this.clampScore(score);

    const riskAssessment = this.buildRiskAssessment(score, reasons, factors);
    const plannedAction = action;
    const requiredChecks =
      plannedAction === "compact_map_entry"
        ? this.buildTombstoneChecks(candidate)
        : this.buildBlockVersionChecks(candidate);

    return {
      riskAssessment,
      plannedAction,
      requiredChecks,
      readiness: riskAssessment.level === "low" ? "ready_for_manual_review" : "needs_more_validation",
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

  private buildRiskAssessment(
    score: number,
    reasons: string[],
    factors: BlockVersionGcRiskFactor[],
  ): BlockVersionGcRiskAssessment {
    return {
      level: score <= LOW_RISK_THRESHOLD ? "low" : score <= MEDIUM_RISK_THRESHOLD ? "medium" : "high",
      score,
      reasons:
        reasons.length > 0
          ? reasons
          : score <= LOW_RISK_THRESHOLD
            ? ["candidate is sufficiently stable for manual review"]
            : ["candidate still needs more validation"],
      factors,
    };
  }

  private buildTombstoneChecks(candidate: BlockVersionGcCandidateFacts): string[] {
    const checks = ["verify_root_stability"];
    if (candidate.rootSourceCount > 1) {
      checks.push("verify_source_consistency");
    }
    if (candidate.retainedByPolicy) {
      checks.push("verify_policy_overlap");
    }
    return checks;
  }

  private buildBlockVersionChecks(candidate: BlockVersionGcCandidateFacts): string[] {
    const checks = ["verify_root_stability", "verify_no_recent_write_dependency"];
    if (candidate.ageBucket !== "stable") {
      checks.push("verify_content_read_paths");
    }
    return checks;
  }

  private addFactor(
    factors: BlockVersionGcRiskFactor[],
    reasons: string[],
    code: string,
    weight: number,
    detail: Record<string, unknown>,
    reason: string,
  ): void {
    factors.push({ code, weight, detail });
    reasons.push(reason);
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

  private clampScore(score: number): number {
    return Math.max(0, Math.min(100, score));
  }
}
