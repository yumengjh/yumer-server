import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 上传资产时的表单字段（与 file 一起通过 multipart/form-data 提交）
 */
export class UploadAssetDto {
  @ApiProperty({ description: '工作空间 ID' })
  @IsString()
  @IsNotEmpty({ message: 'workspaceId 不能为空' })
  workspaceId: string;
}
