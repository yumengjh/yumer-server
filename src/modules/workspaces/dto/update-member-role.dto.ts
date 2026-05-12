import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceRole } from './invite-member.dto';

export class UpdateMemberRoleDto {
  @ApiProperty({
    description: '成员角色',
    example: 'admin',
    enum: WorkspaceRole,
  })
  @IsEnum(WorkspaceRole, { message: '角色必须是 owner、admin、editor 或 viewer' })
  role: string;
}
