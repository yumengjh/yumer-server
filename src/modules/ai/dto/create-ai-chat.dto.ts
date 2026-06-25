import { IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateAiChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  prompt: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  workspaceId?: string;
}
