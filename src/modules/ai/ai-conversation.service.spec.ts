import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AiContextSnapshot } from "../../entities/ai-context-snapshot.entity";
import { AiConversation } from "../../entities/ai-conversation.entity";
import { AiMessage } from "../../entities/ai-message.entity";
import { AiPromptBuilder } from "./ai-prompt-builder";
import { AiConversationService } from "./ai-conversation.service";
import type { AiModelService } from "./ai-model.service";

describe("AiConversationService", () => {
  let conversationRepo: FakeRepository<AiConversation>;
  let messageRepo: FakeRepository<AiMessage>;
  let snapshotRepo: FakeRepository<AiContextSnapshot>;
  let workspacesService: { checkAccess: jest.Mock };
  let modelService: jest.Mocked<Pick<AiModelService, "generate">>;
  let service: AiConversationService;

  beforeEach(() => {
    conversationRepo = new FakeRepository<AiConversation>();
    messageRepo = new FakeRepository<AiMessage>();
    snapshotRepo = new FakeRepository<AiContextSnapshot>();
    workspacesService = { checkAccess: jest.fn().mockResolvedValue(undefined) };
    modelService = {
      generate: jest.fn().mockResolvedValue({
        content: "生成结果",
        model: "test-model",
        usage: { totalTokens: 12 },
      }),
    };
    service = new AiConversationService(
      conversationRepo as any,
      messageRepo as any,
      snapshotRepo as any,
      workspacesService as any,
      modelService as any,
      new AiPromptBuilder(),
    );
  });

  it("creates a conversation and saves user message, context snapshot, and assistant message", async () => {
    const result = await service.sendMessage(
      { prompt: "写一段产品介绍", workspaceId: "ws_1" },
      "user_1",
    );

    expect(workspacesService.checkAccess).toHaveBeenCalledWith("ws_1", "user_1");
    expect(result).toMatchObject({
      conversationId: expect.stringMatching(/^aic_/),
      userMessageId: expect.stringMatching(/^aim_/),
      assistantMessageId: expect.stringMatching(/^aim_/),
      content: "生成结果",
      model: "test-model",
    });
    expect(conversationRepo.items).toHaveLength(1);
    expect(conversationRepo.items[0]).toMatchObject({
      conversationId: result.conversationId,
      userId: "user_1",
      workspaceId: "ws_1",
      status: "active",
      title: "写一段产品介绍",
    });
    expect(messageRepo.items.map((item) => item.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(snapshotRepo.items).toHaveLength(1);
    expect(snapshotRepo.items[0]).toMatchObject({
      conversationId: result.conversationId,
      requestMessageId: result.userMessageId,
      userId: "user_1",
      model: "test-model",
    });
    expect(snapshotRepo.items[0].messages.at(-1)).toEqual({
      role: "user",
      content: "写一段产品介绍",
    });
  });

  it("appends to an existing conversation owned by the current user", async () => {
    const conversation = await conversationRepo.save({
      conversationId: "aic_existing",
      userId: "user_1",
      workspaceId: null,
      title: "旧会话",
      status: "active",
      metadata: {},
    } as AiConversation);
    await messageRepo.save({
      messageId: "aim_old_user",
      conversationId: conversation.conversationId,
      userId: "user_1",
      role: "user",
      content: "旧问题",
      metadata: {},
    } as AiMessage);
    await messageRepo.save({
      messageId: "aim_old_assistant",
      conversationId: conversation.conversationId,
      userId: "user_1",
      role: "assistant",
      content: "旧回答",
      metadata: {},
    } as AiMessage);

    await service.sendMessage(
      { conversationId: "aic_existing", prompt: "继续写" },
      "user_1",
    );

    expect(modelService.generate).toHaveBeenCalledWith({
      messages: expect.arrayContaining([
        { role: "user", content: "旧问题" },
        { role: "assistant", content: "旧回答" },
        { role: "user", content: "继续写" },
      ]),
    });
    expect(messageRepo.items).toHaveLength(4);
  });

  it("rejects conversations owned by another user", async () => {
    await conversationRepo.save({
      conversationId: "aic_other",
      userId: "user_other",
      workspaceId: null,
      title: "别人",
      status: "active",
      metadata: {},
    } as AiConversation);

    await expect(
      service.sendMessage(
        { conversationId: "aic_other", prompt: "继续" },
        "user_1",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects changing workspace of an existing conversation", async () => {
    await conversationRepo.save({
      conversationId: "aic_ws",
      userId: "user_1",
      workspaceId: "ws_1",
      title: "工作区会话",
      status: "active",
      metadata: {},
    } as AiConversation);

    await expect(
      service.sendMessage(
        { conversationId: "aic_ws", workspaceId: "ws_2", prompt: "继续" },
        "user_1",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects empty prompt", async () => {
    await expect(service.sendMessage({ prompt: "   " }, "user_1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("returns service unavailable when model service has no usable config", async () => {
    modelService.generate.mockRejectedValueOnce(
      new ServiceUnavailableException("AI API Key 未配置"),
    );

    await expect(service.sendMessage({ prompt: "hello" }, "user_1")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(messageRepo.items.map((item) => item.role)).toEqual(["user"]);
    expect(snapshotRepo.items).toHaveLength(1);
  });

  it("wraps model failures without saving fake assistant messages", async () => {
    modelService.generate.mockRejectedValueOnce(new Error("provider down"));

    await expect(service.sendMessage({ prompt: "hello" }, "user_1")).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(messageRepo.items.map((item) => item.role)).toEqual(["user"]);
    expect(snapshotRepo.items).toHaveLength(1);
  });
});

class FakeRepository<T extends Record<string, any>> {
  items: T[] = [];
  private nextId = 1;

  create(value: Partial<T>): T {
    return { ...value } as T;
  }

  async save(value: T): Promise<T> {
    if (!value.id) {
      value.id = this.nextId++;
      this.items.push(value);
      return value;
    }

    const index = this.items.findIndex((item) => item.id === value.id);
    if (index >= 0) {
      this.items[index] = value;
    } else {
      this.items.push(value);
    }
    return value;
  }

  async findOne(options: { where: Partial<T> }): Promise<T | null> {
    return (
      this.items.find((item) =>
        Object.entries(options.where).every(([key, value]) => item[key] === value),
      ) ?? null
    );
  }

  async find(options?: { where?: Partial<T> }): Promise<T[]> {
    const where = options?.where ?? {};
    return this.items.filter((item) =>
      Object.entries(where).every(([key, value]) => item[key] === value),
    );
  }
}
