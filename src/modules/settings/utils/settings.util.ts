import {
  SettingsModuleOptions,
  SettingsPatchPayload,
  SettingsPayload,
  SettingsSchema,
} from '../settings.types';

function isPlainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function deepClone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deepMerge<T extends Record<string, any>>(
  base: T,
  override: Record<string, any>,
): T {
  const result = deepClone(base) as Record<string, any>;
  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else if (isPlainObject(value)) {
      result[key] = deepClone(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

function removeEmptyObjects(input: Record<string, any>) {
  for (const [key, value] of Object.entries(input)) {
    if (isPlainObject(value) && Object.keys(value).length === 0) {
      delete input[key];
    }
  }
}

export function applySettingsPatch(
  current: SettingsPayload,
  patch: SettingsPatchPayload,
  options: Pick<SettingsModuleOptions, 'nullMeansUnset'>,
): SettingsPayload {
  const result = deepClone(current) ?? {};
  const nullMeansUnset = options.nullMeansUnset;

  for (const [section, sectionPatch] of Object.entries(patch || {})) {
    if (sectionPatch === null && nullMeansUnset) {
      delete (result as Record<string, any>)[section];
      continue;
    }

    if (!isPlainObject(sectionPatch)) continue;

    const currentSection = isPlainObject((result as Record<string, any>)[section])
      ? deepClone((result as Record<string, any>)[section])
      : {};

    for (const [field, fieldPatch] of Object.entries(sectionPatch)) {
      if (fieldPatch === null && nullMeansUnset) {
        delete currentSection[field];
        continue;
      }
      currentSection[field] = fieldPatch;
    }

    if (Object.keys(currentSection).length === 0) {
      delete (result as Record<string, any>)[section];
    } else {
      (result as Record<string, any>)[section] = currentSection;
    }
  }

  removeEmptyObjects(result as Record<string, any>);
  return result;
}

export function validateSettingsPatch(
  patch: SettingsPatchPayload,
  schema: SettingsSchema,
  options: Pick<SettingsModuleOptions, 'allowUnknownKeys'>,
): string[] {
  const errors: string[] = [];
  if (!isPlainObject(patch)) {
    return ['settings 必须是对象'];
  }

  for (const [sectionKey, sectionValue] of Object.entries(patch)) {
    const sectionSchema = schema[sectionKey];
    if (!sectionSchema) {
      if (!options.allowUnknownKeys) {
        errors.push(`不支持的设置分组: ${sectionKey}`);
      }
      continue;
    }

    if (sectionValue === null) {
      continue;
    }

    if (!isPlainObject(sectionValue)) {
      errors.push(`${sectionKey} 必须是对象或 null`);
      continue;
    }

    for (const [fieldKey, fieldValue] of Object.entries(sectionValue)) {
      const fieldRule = sectionSchema[fieldKey];
      if (!fieldRule) {
        if (!options.allowUnknownKeys) {
          errors.push(`不支持的设置字段: ${sectionKey}.${fieldKey}`);
        }
        continue;
      }

      if (fieldValue === null) {
        continue;
      }

      if (fieldRule.type === 'number') {
        if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
          errors.push(`${sectionKey}.${fieldKey} 必须是数字`);
          continue;
        }
        if (fieldRule.min !== undefined && fieldValue < fieldRule.min) {
          errors.push(`${sectionKey}.${fieldKey} 超出允许范围(${fieldRule.min}~${fieldRule.max})`);
        }
        if (fieldRule.max !== undefined && fieldValue > fieldRule.max) {
          errors.push(`${sectionKey}.${fieldKey} 超出允许范围(${fieldRule.min}~${fieldRule.max})`);
        }
        continue;
      }

      if (fieldRule.type === 'boolean') {
        if (typeof fieldValue !== 'boolean') {
          errors.push(`${sectionKey}.${fieldKey} 必须是布尔值`);
        }
        continue;
      }

      if (fieldRule.type === 'string') {
        if (typeof fieldValue !== 'string') {
          errors.push(`${sectionKey}.${fieldKey} 必须是字符串`);
          continue;
        }
        if (fieldRule.minLength !== undefined && fieldValue.length < fieldRule.minLength) {
          errors.push(`${sectionKey}.${fieldKey} 长度不能小于 ${fieldRule.minLength} 个字符`);
        }
        if (fieldRule.maxLength !== undefined && fieldValue.length > fieldRule.maxLength) {
          errors.push(`${sectionKey}.${fieldKey} 长度不能超过 ${fieldRule.maxLength} 个字符`);
        }
      }
    }
  }

  return errors;
}

export function sanitizeSettingsBySchema(value: unknown, schema: SettingsSchema): SettingsPayload {
  if (!isPlainObject(value)) return {};
  const input = value as Record<string, any>;
  const out: Record<string, any> = {};

  for (const [sectionKey, fields] of Object.entries(schema)) {
    const sectionValue = input[sectionKey];
    if (!isPlainObject(sectionValue)) continue;
    const nextSection: Record<string, any> = {};

    for (const [fieldKey, rule] of Object.entries(fields)) {
      const fieldValue = sectionValue[fieldKey];
      if (fieldValue === null || fieldValue === undefined) continue;

      if (rule.type === 'number') {
        if (typeof fieldValue === 'number' && Number.isFinite(fieldValue)) {
          const withinMin = rule.min === undefined || fieldValue >= rule.min;
          const withinMax = rule.max === undefined || fieldValue <= rule.max;
          if (withinMin && withinMax) {
            nextSection[fieldKey] = fieldValue;
          }
        }
        continue;
      }

      if (rule.type === 'boolean') {
        if (typeof fieldValue === 'boolean') {
          nextSection[fieldKey] = fieldValue;
        }
        continue;
      }

      if (rule.type === 'string') {
        if (typeof fieldValue === 'string') {
          const withinMinLength =
            rule.minLength === undefined || fieldValue.length >= rule.minLength;
          const withinMaxLength =
            rule.maxLength === undefined || fieldValue.length <= rule.maxLength;
          if (withinMinLength && withinMaxLength) {
            nextSection[fieldKey] = fieldValue;
          }
        }
      }
    }

    if (Object.keys(nextSection).length > 0) {
      out[sectionKey] = nextSection;
    }
  }

  return out;
}

function hasOwnLeafValue(settings: SettingsPayload, section: string, field: string): boolean {
  const sectionValue = (settings as Record<string, any>)[section];
  if (!isPlainObject(sectionValue)) return false;
  return (
    Object.prototype.hasOwnProperty.call(sectionValue, field) &&
    sectionValue[field] !== undefined &&
    sectionValue[field] !== null
  );
}

export function buildSettingsSources(
  schema: SettingsSchema,
  userRaw: SettingsPayload,
  workspaceRaw: SettingsPayload,
): Record<string, 'default' | 'user' | 'workspace'> {
  const sources: Record<string, 'default' | 'user' | 'workspace'> = {};

  for (const [section, fields] of Object.entries(schema)) {
    for (const field of Object.keys(fields)) {
      const path = `${section}.${field}`;
      if (hasOwnLeafValue(workspaceRaw, section, field)) {
        sources[path] = 'workspace';
      } else if (hasOwnLeafValue(userRaw, section, field)) {
        sources[path] = 'user';
      } else {
        sources[path] = 'default';
      }
    }
  }

  return sources;
}
