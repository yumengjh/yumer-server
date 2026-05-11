import { DEFAULT_SETTINGS, DEFAULT_SETTINGS_SCHEMA } from '../constants/default-settings';
import {
  applySettingsPatch,
  buildSettingsSources,
  deepMerge,
  sanitizeSettingsBySchema,
  validateSettingsPatch,
} from './settings.util';

describe('settings.util', () => {
  it('should apply patch and remove field when value is null', () => {
    const current = {
      reader: { contentWidth: 900, fontSize: 16 },
      advanced: { compactList: true, codeFontFamily: 'Consolas' },
    };

    const patch = {
      reader: { contentWidth: 860 },
      advanced: { codeFontFamily: null },
    };

    const next = applySettingsPatch(current, patch, { nullMeansUnset: true });
    expect(next).toEqual({
      reader: { contentWidth: 860, fontSize: 16 },
      advanced: { compactList: true },
    });
  });

  it('should validate unknown keys and invalid ranges', () => {
    const patch = {
      reader: { contentWidth: 500 },
      unknown: { foo: 1 },
    };

    const errors = validateSettingsPatch(patch as any, DEFAULT_SETTINGS_SCHEMA, {
      allowUnknownKeys: false,
    });

    expect(errors).toContain('reader.contentWidth 超出允许范围(680~1200)');
    expect(errors).toContain('不支持的设置分组: unknown');
  });

  it('should sanitize settings by schema', () => {
    const sanitized = sanitizeSettingsBySchema(
      {
        reader: { contentWidth: 900, fontSize: 18, foo: 'bar' },
        advanced: { compactList: true, codeFontFamily: 123 },
        other: { value: true },
      },
      DEFAULT_SETTINGS_SCHEMA,
    );

    expect(sanitized).toEqual({
      reader: { contentWidth: 900, fontSize: 18 },
      advanced: { compactList: true },
    });
  });

  it('should build source map with workspace override priority', () => {
    const userRaw = {
      reader: { contentWidth: 900 },
      advanced: { compactList: false },
    };
    const workspaceRaw = {
      reader: { contentWidth: 860 },
    };

    const effective = deepMerge(deepMerge(DEFAULT_SETTINGS, userRaw), workspaceRaw);
    expect(effective.reader?.contentWidth).toBe(860);
    expect(effective.advanced?.compactList).toBe(false);

    const sources = buildSettingsSources(DEFAULT_SETTINGS_SCHEMA, userRaw, workspaceRaw);

    expect(sources['reader.contentWidth']).toBe('workspace');
    expect(sources['advanced.compactList']).toBe('user');
    expect(sources['editor.fontSize']).toBe('default');
  });
});
