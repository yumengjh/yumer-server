import type { GcCandidateRiskLevel } from "../../entities/gc-run-candidate.entity";
import type { GcRunStatus } from "../../entities/gc-run.entity";

export type BlockVersionGcScope = {
  workspaceId?: string;
  docId?: string;
};

export type BlockVersionGcReasonCode =
  | "unreferenced_older_than_policy"
  | "deleted_tombstone_map_entry";

export type BlockVersionGcCandidateAction = "candidate_block_version" | "compact_map_entry";

export type BlockVersionGcCandidateAgeBucket = "fresh" | "recent" | "stable";

export type BlockVersionGcCandidateReadiness = "ready_for_manual_review" | "needs_more_validation";

export type BlockVersionGcRiskFactor = {
  code: string;
  weight: number;
  detail: Record<string, unknown>;
};

export type BlockVersionGcRiskAssessment = {
  level: GcCandidateRiskLevel;
  score: number;
  reasons: string[];
  factors: BlockVersionGcRiskFactor[];
};

export type BlockVersionGcCandidateExplainability = {
  riskAssessment: BlockVersionGcRiskAssessment;
  plannedAction: BlockVersionGcCandidateAction;
  requiredChecks: string[];
  readiness: BlockVersionGcCandidateReadiness;
};

export type BlockVersionGcCandidateReasonDetail = {
  rootKind: "live" | "tombstone" | "none";
  deleted: boolean;
  source: "doc_snapshots" | "document_drafts" | null;
  action: BlockVersionGcCandidateAction;
  hardRooted: boolean;
  retainedByPolicy: boolean;
  gracePeriodMs?: number;
  tombstoneGracePeriodMs?: number;
  keepLatestPerBlock?: number;
  ageMs: number;
  ageBucket: BlockVersionGcCandidateAgeBucket;
  rootSourceCount: number;
  distanceFromLatestVer: number;
  decisionPath: string[];
};

export type BlockVersionGcCandidateFacts = {
  reasonCode: BlockVersionGcReasonCode;
  rootKind: "live" | "tombstone" | "none";
  deleted: boolean;
  source: "doc_snapshots" | "document_drafts" | null;
  action: BlockVersionGcCandidateAction;
  hardRooted: boolean;
  retainedByPolicy: boolean;
  versionCreatedAt: number;
  ageMs: number;
  ageBucket: BlockVersionGcCandidateAgeBucket;
  rootSourceCount: number;
  distanceFromLatestVer: number;
  gracePeriodMs: number;
  tombstoneGracePeriodMs: number;
  keepLatestPerBlock: number;
  decisionPath: string[];
};

export type BlockVersionGcPolicy = {
  gracePeriodMs: number;
  tombstoneGracePeriodMs: number;
  keepLatestPerBlock: number;
  maxCandidatesToStore: number;
  rootSources: Array<"doc_snapshots" | "document_drafts">;
};

export type BlockVersionGcHealth = {
  status: "ok" | "blocked";
  missingRevisionSnapshots: number;
  missingPublishedSnapshots: number;
  missingRootBlockVersions: number;
  samples: {
    missingRevisionSnapshots: Array<{ docId: string; docVer: number }>;
    missingPublishedSnapshots: Array<{ docId: string; publishedSnapshotId: string | null }>;
    missingRootBlockVersions: Array<{ source: string; docId: string; resourceKey: string }>;
  };
};

export type BlockVersionGcCollectorSummary = {
  blockVersionsScanned: number;
  hardRootedBlockVersions: number;
  liveRootedBlockVersions: number;
  tombstoneRootedBlockVersions: number;
  policyRetainedBlockVersions: number;
  softDeletedMapEntries: number;
  candidateBlockVersions: number;
  tombstoneCompactionCandidates: number;
  rootSources: {
    docSnapshots: number;
    documentDrafts: number;
  };
  candidateReasons: Record<string, number>;
};

export type BlockVersionGcCollectorResult = {
  summary: BlockVersionGcCollectorSummary;
  candidates: BlockVersionGcCandidate[];
};

export type BlockVersionGcCandidate = {
  resourceKey: string;
  resourceRowId: number;
  docId: string;
  workspaceId: string | null;
  blockId: string;
  blockVer: number;
  versionCreatedAt: number;
  reasonCode: BlockVersionGcReasonCode;
  reasonDetail: BlockVersionGcCandidateReasonDetail;
  riskLevel: GcCandidateRiskLevel;
} & BlockVersionGcCandidateExplainability;

export type BlockVersionGcPersistedCandidate = {
  resourceKey: string;
  resourceRowId: number;
  docId: string | null;
  workspaceId: string | null;
  blockId: string;
  blockVer: number;
  versionCreatedAt: number;
  reasonCode: BlockVersionGcReasonCode;
  reasonDetail: BlockVersionGcCandidateReasonDetail;
  riskLevel: GcCandidateRiskLevel;
};

export type GcRunListItem = {
  runId: string;
  resourceType: "block_version";
  mode: "preview";
  status: GcRunStatus;
  scope: Record<string, unknown>;
  summary: Record<string, unknown>;
  startedAt: Date;
  finishedAt: Date | null;
};
