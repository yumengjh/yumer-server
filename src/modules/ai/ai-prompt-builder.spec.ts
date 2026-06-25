import { AiPromptBuilder } from "./ai-prompt-builder";

describe("AiPromptBuilder", () => {
  it("builds model messages with system prompt, history, and current prompt", () => {
    const builder = new AiPromptBuilder();

    const result = builder.build({
      prompt: "请写一段产品介绍",
      history: [
        { role: "user", content: "之前的问题" },
        { role: "assistant", content: "之前的回答" },
      ],
    });

    expect(result.messages).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("内容生成助手"),
      }),
      { role: "user", content: "之前的问题" },
      { role: "assistant", content: "之前的回答" },
      { role: "user", content: "请写一段产品介绍" },
    ]);
    expect(result.metadata).toEqual({
      historyLimit: 20,
      historyCount: 2,
      messageCount: 4,
    });
  });

  it("keeps only the latest history messages", () => {
    const builder = new AiPromptBuilder();

    const result = builder.build({
      prompt: "当前问题",
      history: [
        { role: "user", content: "1" },
        { role: "assistant", content: "2" },
        { role: "user", content: "3" },
      ],
      historyLimit: 2,
    });

    expect(result.messages).toEqual([
      expect.objectContaining({ role: "system" }),
      { role: "assistant", content: "2" },
      { role: "user", content: "3" },
      { role: "user", content: "当前问题" },
    ]);
    expect(result.metadata).toEqual({
      historyLimit: 2,
      historyCount: 2,
      messageCount: 4,
    });
  });
});
