/**
 * Delta overlay 同步策略（服务端）
 *
 * 须与 yuediter `src/services/sync/delta-policy.ts` 保持一致。
 * 实验调参只改本文件。
 */

/** diff-match-patch 补丁格式标识 */
export const DELTA_FORMAT = "dmp-v1" as const;

/**
 * 全量 payload 体积门槛（canonical JSON 字节数）。
 * - 默认生产值：8 * 1024（8KB）
 * - 0：不按体积拦截，仅由 {@link DELTA_MAX_RATIO} 决定是否走 delta
 */
export const DELTA_MIN_FULL_SIZE = 0;

/**
 * patch 体积占全量体积的比例上限；超过则发/存全量。
 * 小块编辑常因 JSON 结构开销导致 patch 占比偏高，可适当调高做实验。
 */
export const DELTA_MAX_RATIO = 0.5;

/** 连续 delta 链达到此长度时触发 compaction（落全量快照） */
export const COMPACTION_CHAIN_LIMIT = 12;

/** 测试 fixture 用的大块体积（原 8KB 阈值，非运行时策略） */
export const DELTA_REFERENCE_LARGE_BLOCK_BYTES = 8 * 1024;
