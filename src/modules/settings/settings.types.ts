import { SettingsScopeType } from '../../entities/settings-profile.entity';

export interface SettingsPayload {
  reader?: {
    contentWidth?: number;
    fontSize?: number;
  };
  editor?: {
    contentWidth?: number;
    fontSize?: number;
  };
  advanced?: {
    compactList?: boolean;
    codeFontFamily?: string;
  };
}

export interface SettingsPatchPayload {
  reader?: {
    contentWidth?: number | null;
    fontSize?: number | null;
  } | null;
  editor?: {
    contentWidth?: number | null;
    fontSize?: number | null;
  } | null;
  advanced?: {
    compactList?: boolean | null;
    codeFontFamily?: string | null;
  } | null;
}

export interface SettingLeafRule {
  type: 'number' | 'boolean' | 'string';
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
}

export type SettingsSchema = Record<string, Record<string, SettingLeafRule>>;

export interface SettingsModuleOptions {
  defaults: SettingsPayload;
  schema: SettingsSchema;
  allowUnknownKeys: boolean;
  nullMeansUnset: boolean;
}

export interface SettingsProfileLookup {
  scopeType: SettingsScopeType;
  scopeId: string;
}
