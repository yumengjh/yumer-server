import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { AiConversationService } from "./ai-conversation.service";
import { CreateAiChatDto } from "./dto/create-ai-chat.dto";
import { ListAiConversationsDto } from "./dto/list-ai-conversations.dto";

@ApiTags("ai")
@Controller("ai")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AiController {
  constructor(private readonly aiConversationService: AiConversationService) {}

  @Post("chat")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "AI 对话生成" })
  @ApiResponse({ status: 200, description: "生成成功" })
  async chat(
    @Body() dto: CreateAiChatDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.aiConversationService.sendMessage(dto, user.userId);
  }

  @Get("conversations")
  @ApiOperation({ summary: "AI 会话列表" })
  @ApiResponse({ status: 200, description: "获取成功" })
  async listConversations(
    @Query() dto: ListAiConversationsDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.aiConversationService.listConversations(dto, user.userId);
  }

  @Get("conversations/:conversationId")
  @ApiOperation({ summary: "AI 会话详情" })
  @ApiResponse({ status: 200, description: "获取成功" })
  async getConversation(
    @Param("conversationId") conversationId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.aiConversationService.getConversation(conversationId, user.userId);
  }
}
