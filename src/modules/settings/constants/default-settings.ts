import { SettingsModuleOptions, SettingsPayload, SettingsSchema } from '../settings.types';

export const SETTINGS_MODULE_OPTIONS = Symbol('SETTINGS_MODULE_OPTIONS');

export const DEFAULT_SETTINGS: SettingsPayload = {
  reader: {
    contentWidth: 800,
    fontSize: 16,
  },
  editor: {
    contentWidth: 800,
    fontSize: 16,
  },
  advanced: {
    compactList: true,
    codeFontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace',
  },
};

export const DEFAULT_SETTINGS_SCHEMA: SettingsSchema = {
  reader: {
    contentWidth: { type: 'number', min: 680, max: 1200 },
    fontSize: { type: 'number', min: 13, max: 22 },
  },
  editor: {
    contentWidth: { type: 'number', min: 680, max: 1200 },
    fontSize: { type: 'number', min: 13, max: 22 },
  },
  advanced: {
    compactList: { type: 'boolean' },
    codeFontFamily: { type: 'string', minLength: 1, maxLength: 500 },
  },
};

export const DEFAULT_SETTINGS_MODULE_OPTIONS: SettingsModuleOptions = {
  defaults: DEFAULT_SETTINGS,
  schema: DEFAULT_SETTINGS_SCHEMA,
  allowUnknownKeys: false,
  nullMeansUnset: true,
};
