import { ApiProperty } from '@nestjs/swagger';
import { IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SettingsPatchDto } from './settings-patch.dto';

export class UpdateMySettingsDto {
  @ApiProperty({ description: '设置补丁（部分更新）', type: SettingsPatchDto })
  @IsObject()
  @ValidateNested()
  @Type(() => SettingsPatchDto)
  settings: SettingsPatchDto;
}
