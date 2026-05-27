import { Injectable } from "@nestjs/common";
import type { BlockVersionGcPolicy } from "./gc.types";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

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
   * 每个 `blockId` 无论是否被引用，都额外保留最近 N 个版本。
   *
   * 作用：
   * - 值越大：越保守，candidates 越少
   * - 值越小：越激进，candidates 越容易出现
   *
   * 本地调试如果想尽快看到结果，建议先设成 `1`，极端调试可以设成 `0`。
   */
  keepLatestPerBlock: 1,

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
}
