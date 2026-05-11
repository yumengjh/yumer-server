import { IsEmail, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum WorkspaceRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  EDITOR = 'editor',
  VIEWER = 'viewer',
}

export class InviteMemberDto {
  @ApiProperty({ description: '用户邮箱', example: 'user@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @ApiProperty({
    description: '成员角色',
    example: 'editor',
    enum: WorkspaceRole,
  })
  @IsEnum(WorkspaceRole, { message: '角色必须是 owner、admin、editor 或 viewer' })
  role: string;
}
