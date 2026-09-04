import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsWhere, Repository } from "typeorm";
import { AiContextSnapshot } from "../../entities/ai-context-snapshot.entity";
import { AiConversation } from "../../entities/ai-conversation.entity";
import { AiMessage } from "../../entities/ai-message.entity";
import {
  generateAiContextSnapshotId,
  generateAiConversationId,
  generateAiMessageId,
} from "../../common/utils/id-generator.util";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { CreateAiChatDto } from "./dto/create-ai-chat.dto";
import { ListAiConversationsDto } from "./dto/list-ai-conversations.dto";
import { AiModelService } from "./ai-model.service";
import { AiPromptBuilder } from "./ai-prompt-builder";
import type { AiPromptMessage } from "./types/ai-message-role";

@Injectable()
export class AiConversationService {
  constructor(
    @InjectRepository(AiConversation)
    private readonly conversationRepository: Repository<AiConversation>,
    @InjectRepository(AiMessage)
    private readonly messageRepository: Repository<AiMessage>,
    @InjectRepository(AiContextSnapshot)
    private readonly contextSnapshotRepository: Repository<AiContextSnapshot>,
    private readonly workspacesService: WorkspacesService,
    private readonly aiModelService: AiModelService,
    private readonly aiPromptBuilder: AiPromptBuilder,
  ) {}

  async sendMessage(dto: CreateAiChatDto, userId: string) {
    const prompt = dto.prompt?.trim();
    if (!prompt) {
      throw new BadRequestException("提示词不能为空");
    }

    const conversation = await this.resolveConversation(dto, userId, prompt);
    const history = await this.loadHistory(conversation.conversationId, userId);

    const userMessage = await this.messageRepository.save(
      this.messageRepository.create({
        messageId: generateAiMessageId(),
        conversationId: conversation.conversationId,
        userId,
        role: "user",
        content: prompt,
        metadata: {},
      }),
    );

    const context = this.aiPromptBuilder.build({ prompt, history });
    const snapshot = await this.contextSnapshotRepository.save(
      this.contextSnapshotRepository.create({
        snapshotId: generateAiContextSnapshotId(),
        conversationId: conversation.conversationId,
        requestMessageId: userMessage.messageId,
        userId,
        messages: context.messages,
        model: "unknown",
        metadata: context.metadata,
      }),
    );

    let modelResult;
    try {
      modelResult = await this.aiModelService.generate({
        messages: context.messages,
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new BadGatewayException("AI 模型调用失败");
    }

    snapshot.model = modelResult.model;
    snapshot.metadata = {
      ...snapshot.metadata,
      usage: modelResult.usage ?? null,
    };
    await this.contextSnapshotRepository.save(snapshot);

    const assistantMessage = await this.messageRepository.save(
      this.messageRepository.create({
        messageId: generateAiMessageId(),
        conversationId: conversation.conversationId,
        userId,
        role: "assistant",
        content: modelResult.content,
        metadata: {
          model: modelResult.model,
          usage: modelResult.usage ?? null,
        },
      }),
    );

    conversation.updatedAt = new Date();
    await this.conversationRepository.save(conversation);

    return {
      conversationId: conversation.conversationId,
      userMessageId: userMessage.messageId,
      assistantMessageId: assistantMessage.messageId,
      content: modelResult.content,
      model: modelResult.model,
    };
  }

  async sendMessageStream(
    dto: CreateAiChatDto,
    userId: string,
    onDelta: (delta: string) => void | Promise<void>,
  ) {
    const prompt = dto.prompt?.trim();
    if (!prompt) {
      throw new BadRequestException("提示词不能为空");
    }

    const conversation = await this.resolveConversation(dto, userId, prompt);
    const history = await this.loadHistory(conversation.conversationId, userId);

    const userMessage = await this.messageRepository.save(
      this.messageRepository.create({
        messageId: generateAiMessageId(),
        conversationId: conversation.conversationId,
        userId,
        role: "user",
        content: prompt,
        metadata: {},
      }),
    );

    const context = this.aiPromptBuilder.build({ prompt, history });
    const snapshot = await this.contextSnapshotRepository.save(
      this.contextSnapshotRepository.create({
        snapshotId: generateAiContextSnapshotId(),
        conversationId: conversation.conversationId,
        requestMessageId: userMessage.messageId,
        userId,
        messages: context.messages,
        model: "unknown",
        metadata: context.metadata,
      }),
    );

    let content = "";
    let model = "unknown";
    let usage: Record<string, unknown> | undefined;

    try {
      for await (const chunk of this.aiModelService.stream({
        messages: context.messages,
      })) {
        model = chunk.model;
        usage = chunk.usage ?? usage;
        content += chunk.delta;
        await onDelta(chunk.delta);
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new BadGatewayException("AI 模型调用失败");
    }

    snapshot.model = model;
    snapshot.metadata = {
      ...snapshot.metadata,
      usage: usage ?? null,
    };
    await this.contextSnapshotRepository.save(snapshot);

    const assistantMessage = await this.messageRepository.save(
      this.messageRepository.create({
        messageId: generateAiMessageId(),
        conversationId: conversation.conversationId,
        userId,
        role: "assistant",
        content,
        metadata: {
          model,
          usage: usage ?? null,
        },
      }),
    );

    conversation.updatedAt = new Date();
    await this.conversationRepository.save(conversation);

    return {
      conversationId: conversation.conversationId,
      userMessageId: userMessage.messageId,
      assistantMessageId: assistantMessage.messageId,
      content,
      model,
    };
  }

  async listConversations(dto: ListAiConversationsDto, userId: string) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const where: FindOptionsWhere<AiConversation> = {
      userId,
      status: "active",
    };
    if (dto.workspaceId) {
      await this.workspacesService.checkAccess(dto.workspaceId, userId);
      where.workspaceId = dto.workspaceId;
    }

    const [items, total] = await this.conversationRepository.findAndCount({
      where,
      order: { updatedAt: "DESC" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { items, total, page, pageSize };
  }

  async getConversation(conversationId: string, userId: string) {
    const conversation = await this.getOwnedConversation(conversationId, userId);
    const messages = await this.loadHistory(conversationId, userId, 1000);
    return { ...conversation, messages };
  }

  private async resolveConversation(
    dto: CreateAiChatDto,
    userId: string,
    prompt: string,
  ): Promise<AiConversation> {
    if (dto.conversationId) {
      const conversation = await this.getOwnedConversation(dto.conversationId, userId);
      if (
        dto.workspaceId &&
        conversation.workspaceId &&
        dto.workspaceId !== conversation.workspaceId
      ) {
        throw new BadRequestException("不能切换已有 AI 会话的工作空间");
      }
      if (conversation.workspaceId) {
        await this.workspacesService.checkAccess(conversation.workspaceId, userId);
      }
      return conversation;
    }

    if (dto.workspaceId) {
      await this.workspacesService.checkAccess(dto.workspaceId, userId);
    }

    return this.conversationRepository.save(
      this.conversationRepository.create({
        conversationId: generateAiConversationId(),
        userId,
        workspaceId: dto.workspaceId ?? null,
        title: this.createTitle(prompt),
        status: "active",
        metadata: {},
      }),
    );
  }

  private async getOwnedConversation(
    conversationId: string,
    userId: string,
  ): Promise<AiConversation> {
    const conversation = await this.conversationRepository.findOne({
      where: { conversationId },
    });
    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundException("AI 会话不存在");
    }
    return conversation;
  }

  private async loadHistory(
    conversationId: string,
    userId: string,
    limit = 20,
  ): Promise<AiPromptMessage[]> {
    const messages = await this.messageRepository.find({
      where: { conversationId, userId },
      order: { createdAt: "ASC" },
    });

    return messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-limit)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
  }

  private createTitle(prompt: string): string {
    return prompt.length > 40 ? `${prompt.slice(0, 40)}...` : prompt;
  }
}
