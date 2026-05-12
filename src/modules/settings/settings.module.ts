import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { SettingsProfile } from '../../entities/settings-profile.entity';
import {
  DEFAULT_SETTINGS_MODULE_OPTIONS,
  SETTINGS_MODULE_OPTIONS,
} from './constants/default-settings';
import { SettingsModuleOptions } from './settings.types';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ActivitiesModule } from '../activities/activities.module';

@Module({})
export class SettingsModule {
  static forRoot(options: Partial<SettingsModuleOptions> = {}): DynamicModule {
    const optionDefaults = options.defaults || {};
    const optionSchema = options.schema || {};

    const mergedOptions: SettingsModuleOptions = {
      ...DEFAULT_SETTINGS_MODULE_OPTIONS,
      ...options,
      defaults: {
        reader: {
          ...DEFAULT_SETTINGS_MODULE_OPTIONS.defaults.reader,
          ...(optionDefaults.reader || {}),
        },
        editor: {
          ...DEFAULT_SETTINGS_MODULE_OPTIONS.defaults.editor,
          ...(optionDefaults.editor || {}),
        },
        advanced: {
          ...DEFAULT_SETTINGS_MODULE_OPTIONS.defaults.advanced,
          ...(optionDefaults.advanced || {}),
        },
      },
      schema: {
        reader: {
          ...DEFAULT_SETTINGS_MODULE_OPTIONS.schema.reader,
          ...(optionSchema.reader || {}),
        },
        editor: {
          ...DEFAULT_SETTINGS_MODULE_OPTIONS.schema.editor,
          ...(optionSchema.editor || {}),
        },
        advanced: {
          ...DEFAULT_SETTINGS_MODULE_OPTIONS.schema.advanced,
          ...(optionSchema.advanced || {}),
        },
      },
    };

    return {
      module: SettingsModule,
      imports: [TypeOrmModule.forFeature([SettingsProfile]), WorkspacesModule, ActivitiesModule],
      controllers: [SettingsController],
      providers: [
        SettingsService,
        {
          provide: SETTINGS_MODULE_OPTIONS,
          useValue: mergedOptions,
        },
      ],
      exports: [SettingsService],
    };
  }
}
