import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFavoriteDto {
  @ApiProperty({ description: '文档 ID' })
  @IsString()
  @IsNotEmpty()
  docId: string;
}
