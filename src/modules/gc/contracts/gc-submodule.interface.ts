export type GcSubmoduleCapabilities = {
  health?: boolean;
  preview?: boolean;
  sweep?: boolean;
  policy?: boolean;
  candidates?: boolean;
  pool?: boolean;
  maintenance?: boolean;
};

export type GcSubmoduleDescriptor = {
  key: string;
  displayName: string;
  parentKey: string | null;
  routePrefix: string;
  capabilities: GcSubmoduleCapabilities;
};

export interface GcSubmoduleDefinition {
  describe(): GcSubmoduleDescriptor;
}
