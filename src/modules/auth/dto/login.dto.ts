import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: '邮箱或用户名', example: 'john@example.com' })
  @IsString()
  @MinLength(1)
  emailOrUsername: string;

  @ApiProperty({ description: '密码', example: 'SecurePass123!' })
  @IsString()
  @MinLength(1)
  password: string;
}
