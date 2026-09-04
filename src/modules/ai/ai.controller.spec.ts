import { AiController } from "./ai.controller";
import type { AiConversationService } from "./ai-conversation.service";
import type { CreateAiChatDto } from "./dto/create-ai-chat.dto";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AiController streamChat", () => {
  it("writes delta SSE frames before the stream completes", async () => {
    const writes: string[] = [];
    let ended = false;
    const service = {
      sendMessageStream: jest.fn(
        async (
          _dto: CreateAiChatDto,
          _userId: string,
          onDelta: (delta: string) => void | Promise<void>,
        ) => {
          await onDelta("first");
          await delay(30);
          await onDelta("second");
          return {
            conversationId: "aic_1",
            userMessageId: "aim_user",
            assistantMessageId: "aim_assistant",
            content: "firstsecond",
            model: "test-model",
          };
        },
      ),
    } as unknown as AiConversationService;
    const response = {
      socket: { setNoDelay: jest.fn() },
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      flush: jest.fn(),
      write: jest.fn((value: string) => {
        writes.push(value);
        return true;
      }),
      end: jest.fn(() => {
        ended = true;
      }),
    };
    const controller = new AiController(service);

    const streamPromise = controller.streamChat(
      { prompt: "hello" },
      { userId: "user_1" },
      response as never,
    );

    await delay(1);

    expect(ended).toBe(false);
    expect(writes.join("")).toContain('event: delta\ndata: {"delta":"first"}\n\n');
    expect(response.flush).toHaveBeenCalled();

    await streamPromise;

    expect(writes.join("")).toContain('event: delta\ndata: {"delta":"second"}\n\n');
    expect(writes.join("")).toContain("event: done\n");
    expect(ended).toBe(true);
  });
});
