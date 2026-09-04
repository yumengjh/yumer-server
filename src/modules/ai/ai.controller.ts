import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
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

  @Post("chat/stream")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "AI 对话流式生成" })
  @ApiResponse({ status: 200, description: "SSE 流式返回生成结果" })
  async streamChat(
    @Body() dto: CreateAiChatDto,
    @CurrentUser() user: { userId: string },
    @Res() res: Response,
  ) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Transfer-Encoding", "chunked");
    res.socket?.setNoDelay(true);
    res.flushHeaders?.();

    const writeEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      (res as Response & { flush?: () => void }).flush?.();
    };

    try {
      res.write(": connected\n\n");
      (res as Response & { flush?: () => void }).flush?.();
      const result = await this.aiConversationService.sendMessageStream(
        dto,
        user.userId,
        (delta) => writeEvent("delta", { delta }),
      );
      writeEvent("done", result);
    } catch (error) {
      writeEvent("error", {
        message: error instanceof Error ? error.message : "AI 流式生成失败",
      });
    } finally {
      res.end();
    }
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
