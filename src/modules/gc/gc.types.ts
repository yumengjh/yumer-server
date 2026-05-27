import type { GcCandidateRiskLevel } from "../../entities/gc-run-candidate.entity";
import type { GcRunStatus } from "../../entities/gc-run.entity";

export type BlockVersionGcScope = {
  workspaceId?: string;
  docId?: string;
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

export type BlockVersionGcCandidate = {
  resourceKey: string;
  resourceRowId: number;
  docId: string;
  workspaceId: string | null;
  blockId: string;
  blockVer: number;
  versionCreatedAt: number;
  reasonCode: "unreferenced_older_than_policy" | "deleted_tombstone_map_entry";
  reasonDetail: Record<string, unknown>;
  riskLevel: GcCandidateRiskLevel;
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
