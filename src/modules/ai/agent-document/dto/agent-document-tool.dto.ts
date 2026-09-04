import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export enum AgentDocumentClientOperationType {
  INSERT_BLOCK = "insert_block",
  UPDATE_BLOCK = "update_block",
  DELETE_BLOCK = "delete_block",
  MOVE_BLOCK = "move_block",
  REPLACE_SELECTION = "replace_selection",
}

export class AgentDocumentContextDto {
  @ApiProperty({ description: "文档 ID", example: "doc_1234567890_abc123" })
  @IsString()
  @IsNotEmpty()
  docId: string;

  @ApiPropertyOptional({ description: "最大树深度", example: 3 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  maxDepth?: number;

  @ApiPropertyOptional({ description: "分页起始块 ID", example: "b_1234567890_abc123" })
  @IsOptional()
  @IsString()
  startBlockId?: string;

  @ApiPropertyOptional({ description: "最多返回块数量", example: 200 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class AgentDocumentClientContextDto {
  @ApiProperty({ description: "文档 ID", example: "doc_1234567890_abc123" })
  @IsString()
  @IsNotEmpty()
  docId: string;

  @ApiProperty({ description: "前端当前基于的服务端 head", example: 3 })
  @IsNumber()
  head: number;

  @ApiPropertyOptional({ description: "前端当前草稿修订号", example: 12 })
  @IsOptional()
  @IsNumber()
  draftRevision?: number;

  @ApiPropertyOptional({ description: "当前选区所在块 ID", example: "b_1234567890_abc123" })
  @IsOptional()
  @IsString()
  selectionBlockId?: string;

  @ApiPropertyOptional({ description: "前端提供的编辑器上下文快照" })
  @IsOptional()
  @IsObject()
  snapshot?: Record<string, unknown>;
}

export class AgentDocumentClientOperationDto {
  @ApiProperty({
    description: "前端编辑器可执行的客户端操作类型",
    enum: AgentDocumentClientOperationType,
  })
  @IsEnum(AgentDocumentClientOperationType)
  type: AgentDocumentClientOperationType;

  @ApiPropertyOptional({ description: "目标块 ID", example: "b_1234567890_abc123" })
  @IsOptional()
  @IsString()
  blockId?: string;

  @ApiPropertyOptional({ description: "目标父块 ID", example: "b_1234567890_abc123" })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ description: "排序锚点块 ID，由前端解析为具体 sortKey" })
  @IsOptional()
  @IsString()
  anchorBlockId?: string;

  @ApiPropertyOptional({ description: "块类型", example: "paragraph" })
  @IsOptional()
  @IsString()
  blockType?: string;

  @ApiPropertyOptional({ description: "块 payload 或选区替换 payload" })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class AgentDocumentProposalDto {
  @ApiProperty({ description: "文档 ID", example: "doc_1234567890_abc123" })
  @IsString()
  @IsNotEmpty()
  docId: string;

  @ApiProperty({ description: "用户或 Agent 的编辑意图" })
  @IsString()
  @IsNotEmpty()
  instruction: string;

  @IsOptional()
  @ValidateNested()
  clientContext?: AgentDocumentClientContextDto;

  @ApiProperty({
    description: "Agent 生成、由前端编辑器执行的操作提案",
    type: "array",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  operations: AgentDocumentClientOperationDto[];
}
