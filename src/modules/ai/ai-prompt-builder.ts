import { Injectable } from "@nestjs/common";
import type { AiPromptMessage } from "./types/ai-message-role";

export interface BuildAiPromptInput {
  prompt: string;
  history: AiPromptMessage[];
  historyLimit?: number;
}

export interface BuildAiPromptResult {
  messages: AiPromptMessage[];
  metadata: {
    historyLimit: number;
    historyCount: number;
    messageCount: number;
  };
}

@Injectable()
export class AiPromptBuilder {
  private readonly defaultHistoryLimit = 20;

  build(input: BuildAiPromptInput): BuildAiPromptResult {
    const historyLimit = input.historyLimit ?? this.defaultHistoryLimit;
    const history = input.history.slice(-historyLimit);
    const messages: AiPromptMessage[] = [
      {
        role: "system",
        content:
          "你是一个内容生成助手。默认使用中文回答，除非用户明确要求其他语言。不要伪造事实；不确定时说明不确定。",
      },
      ...history,
      { role: "user", content: input.prompt },
    ];

    return {
      messages,
      metadata: {
        historyLimit,
        historyCount: history.length,
        messageCount: messages.length,
      },
    };
  }
}
