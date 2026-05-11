import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

class ReaderSettingsPatchDto {
  @ApiPropertyOptional({ description: '阅读区域宽度（680~1200）', example: 920 })
  @IsOptional()
  @IsNumber()
  @Min(680)
  @Max(1200)
  contentWidth?: number | null;

  @ApiPropertyOptional({ description: '阅读字体大小（13~22）', example: 16 })
  @IsOptional()
  @IsNumber()
  @Min(13)
  @Max(22)
  fontSize?: number | null;
}

class EditorSettingsPatchDto {
  @ApiPropertyOptional({ description: '编辑区域宽度（680~1200）', example: 900 })
  @IsOptional()
  @IsNumber()
  @Min(680)
  @Max(1200)
  contentWidth?: number | null;

  @ApiPropertyOptional({ description: '编辑字体大小（13~22）', example: 16 })
  @IsOptional()
  @IsNumber()
  @Min(13)
  @Max(22)
  fontSize?: number | null;
}

class AdvancedSettingsPatchDto {
  @ApiPropertyOptional({ description: '是否使用紧凑列表', example: true })
  @IsOptional()
  @IsBoolean()
  compactList?: boolean | null;

  @ApiPropertyOptional({ description: '代码字体栈（1~500 字符）' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  codeFontFamily?: string | null;
}

export class SettingsPatchDto {
  @ApiPropertyOptional({ description: '阅读设置' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ReaderSettingsPatchDto)
  reader?: ReaderSettingsPatchDto | null;

  @ApiPropertyOptional({ description: '编辑设置' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EditorSettingsPatchDto)
  editor?: EditorSettingsPatchDto | null;

  @ApiPropertyOptional({ description: '高级设置' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AdvancedSettingsPatchDto)
  advanced?: AdvancedSettingsPatchDto | null;
}
