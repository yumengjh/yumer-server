import type { DiffRefKind } from './diff-versions.dto';

export interface BlockSnapshot {
  ver: number;
  type: string;
  payload: object;
  parentId: string;
  sortKey: string;
  indent: number;
  hash: string;
}

export interface DiffChangeItem {
  type: 'added' | 'deleted' | 'modified' | 'moved' | 'reordered' | 'indent-changed';
  blockId: string;
  from?: BlockSnapshot;
  to?: BlockSnapshot;
}

export interface DiffSummary {
  added: number;
  deleted: number;
  modified: number;
  moved: number;
  reordered: number;
  indentChanged: number;
  unchanged: number;
}

export interface DiffRefDescriptor {
  kind: DiffRefKind;
  label: string;
  version?: number | null;
}

export interface DiffResponse {
  docId: string;
  fromVer: number | null;
  toVer: number | null;
  fromRef: DiffRefDescriptor;
  toRef: DiffRefDescriptor;
  summary: DiffSummary;
  changes: DiffChangeItem[];
  fromContent: {
    tree: any;
    totalBlocks: number;
    returnedBlocks: number;
    hasMore: boolean;
    nextStartBlockId?: string;
  };
  toContent: {
    tree: any;
    totalBlocks: number;
    returnedBlocks: number;
    hasMore: boolean;
    nextStartBlockId?: string;
  };
}
