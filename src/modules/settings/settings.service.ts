import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SettingsProfile, SettingsScopeType } from '../../entities/settings-profile.entity';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { ActivitiesService } from '../activities/activities.service';
import {
  DEFAULT_SETTINGS_MODULE_OPTIONS,
  SETTINGS_MODULE_OPTIONS,
} from './constants/default-settings';
import { SettingsPatchPayload, SettingsPayload } from './settings.types';
import type { SettingsModuleOptions } from './settings.types';
import {
  applySettingsPatch,
  buildSettingsSources,
  deepClone,
  deepMerge,
  sanitizeSettingsBySchema,
  validateSettingsPatch,
} from './utils/settings.util';
import { generateSettingsProfileId } from '../../common/utils/id-generator.util';
import { SETTINGS_ACTIONS } from '../activities/constants/activity-actions';
import { isSitePublicAnonymousUserId } from '../../common/decorators/public.decorator';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(SettingsProfile)
    private settingsProfileRepository: Repository<SettingsProfile>,
    private workspacesService: WorkspacesService,
    private activitiesService: ActivitiesService,
    @Inject(SETTINGS_MODULE_OPTIONS)
    private readonly moduleOptions: SettingsModuleOptions,
  ) {}

  private get options(): SettingsModuleOptions {
    return this.moduleOptions || DEFAULT_SETTINGS_MODULE_OPTIONS;
  }

  async getMySettings(userId: string) {
    const userRawSettings = await this.getRawSettings('user', userId);
    return {
      settings: deepMerge(this.options.defaults, userRawSettings),
    };
  }

  async updateMySettings(userId: string, patch: SettingsPatchPayload) {
    this.assertPatchValid(patch);

    const before = await this.getRawSettings('user', userId);
    const next = sanitizeSettingsBySchema(
      applySettingsPatch(before, patch, {
        nullMeansUnset: this.options.nullMeansUnset,
      }),
      this.options.schema,
    );

    const saved = await this.saveRawSettings('user', userId, next);

    return {
      settings: deepMerge(this.options.defaults, saved),
    };
  }

  async getWorkspaceSettings(workspaceId: string, userId: string) {
    if (isSitePublicAnonymousUserId(userId)) {
      await this.workspacesService.findOne(workspaceId, userId);
    } else {
      await this.workspacesService.checkAccess(workspaceId, userId);
    }
    const workspaceRawSettings = await this.getRawSettings('workspace', workspaceId);
    return {
      settings: workspaceRawSettings,
    };
  }

  async updateWorkspaceSettings(workspaceId: string, userId: string, patch: SettingsPatchPayload) {
    await this.workspacesService.checkAccess(workspaceId, userId);
    await this.workspacesService.checkAdminPermission(workspaceId, userId);
    this.assertPatchValid(patch);

    const before = await this.getRawSettings('workspace', workspaceId);
    const next = sanitizeSettingsBySchema(
      applySettingsPatch(before, patch, {
        nullMeansUnset: this.options.nullMeansUnset,
      }),
      this.options.schema,
    );
    const saved = await this.saveRawSettings('workspace', workspaceId, next);

    await this.activitiesService.record(
      workspaceId,
      SETTINGS_ACTIONS.WORKSPACE_UPDATE,
      'workspace_settings',
      workspaceId,
      userId,
      { before, patch, after: saved },
    );

    return {
      settings: saved,
    };
  }

  async clearWorkspaceSettings(workspaceId: string, userId: string) {
    await this.workspacesService.checkAccess(workspaceId, userId);
    await this.workspacesService.checkAdminPermission(workspaceId, userId);

    const before = await this.getRawSettings('workspace', workspaceId);
    await this.saveRawSettings('workspace', workspaceId, {});

    await this.activitiesService.record(
      workspaceId,
      SETTINGS_ACTIONS.WORKSPACE_CLEAR,
      'workspace_settings',
      workspaceId,
      userId,
      { before, after: {} },
    );

    return { message: '工作空间设置已清空' };
  }

  async getEffectiveSettings(userId: string, workspaceId?: string) {
    const userRawSettings = await this.getRawSettings('user', userId);
    const userSettings = deepMerge(this.options.defaults, userRawSettings);

    let workspaceRawSettings: SettingsPayload = {};
    if (workspaceId) {
      await this.workspacesService.checkAccess(workspaceId, userId);
      workspaceRawSettings = await this.getRawSettings('workspace', workspaceId);
    }

    const effectiveSettings = deepMerge(userSettings, workspaceRawSettings);
    const sources = buildSettingsSources(
      this.options.schema,
      userRawSettings,
      workspaceRawSettings,
    );

    return {
      userSettings,
      workspaceSettings: workspaceRawSettings,
      effectiveSettings,
      sources,
    };
  }

  private assertPatchValid(patch: SettingsPatchPayload) {
    const errors = validateSettingsPatch(patch, this.options.schema, {
      allowUnknownKeys: this.options.allowUnknownKeys,
    });
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '));
    }
  }

  private async getRawSettings(
    scopeType: SettingsScopeType,
    scopeId: string,
  ): Promise<SettingsPayload> {
    const profile = await this.settingsProfileRepository.findOne({
      where: { scopeType, scopeId },
    });

    if (!profile?.settings) {
      return {};
    }

    return sanitizeSettingsBySchema(profile.settings, this.options.schema);
  }

  private async saveRawSettings(
    scopeType: SettingsScopeType,
    scopeId: string,
    settings: SettingsPayload,
  ): Promise<SettingsPayload> {
    const normalized = sanitizeSettingsBySchema(deepClone(settings), this.options.schema);
    const existing = await this.settingsProfileRepository.findOne({
      where: { scopeType, scopeId },
    });

    if (existing) {
      existing.settings = normalized;
      await this.settingsProfileRepository.save(existing);
      return normalized;
    }

    const created = this.settingsProfileRepository.create({
      profileId: generateSettingsProfileId(),
      scopeType,
      scopeId,
      settings: normalized,
    });
    await this.settingsProfileRepository.save(created);
    return normalized;
  }
}
