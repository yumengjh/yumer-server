export type RealtimeSseEvent =
  | DocumentRemoteOpsEvent
  | DocumentReloadRequiredEvent
  | RealtimeHeartbeatEvent;

export type RemoteDocumentOperation =
  | RemoteCreateOperation
  | RemoteUpdateOperation
  | RemoteDeleteOperation
  | RemoteMoveOperation;

export interface RemoteCreateOperation {
  type: "create";
  blockId: string;
  clientId?: string | null;
  parentId: string;
  sortKey: string;
  blockType: string;
  payload: Record<string, unknown>;
  plainText?: string;
  version?: number;
}

export interface RemoteUpdateOperation {
  type: "update";
  blockId: string;
  payload: Record<string, unknown>;
  plainText?: string;
  version?: number;
}

export interface RemoteDeleteOperation {
  type: "delete";
  blockId: string;
  version?: number;
}

export interface RemoteMoveOperation {
  type: "move";
  blockId: string;
  parentId: string;
  sortKey: string;
  version?: number;
}

export interface DocumentRemoteOpsEvent {
  type: "document_remote_ops";
  eventId: string;
  docId: string;
  serverHead: number;
  previousDraftRevision: number;
  draftRevision: number;
  source: "autosync" | "manual-save" | "agent" | "unknown";
  originClientId: string | null;
  originTabId: string | null;
  clientBatchId: string;
  operations: RemoteDocumentOperation[];
  occurredAt: string;
}

export interface DocumentReloadRequiredEvent {
  type: "document_reload_required";
  eventId: string;
  docId: string;
  serverHead: number;
  draftRevision: number;
  reason:
    | "operations_not_replayable"
    | "batch_partial_failure"
    | "server_compaction"
    | "manual_admin_change";
  occurredAt: string;
}

export interface RealtimeHeartbeatEvent {
  type: "heartbeat";
  eventId: string;
  docId: string;
  occurredAt: string;
}
