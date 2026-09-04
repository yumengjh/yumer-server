import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import OpenAI from "openai";
import type { AiPromptMessage } from "./types/ai-message-role";

export interface AiModelGenerateInput {
  messages: AiPromptMessage[];
}

export interface AiModelGenerateResult {
  content: string;
  model: string;
  usage?: Record<string, unknown>;
}

export interface AiModelStreamChunk {
  delta: string;
  model: string;
  usage?: Record<string, unknown>;
}

@Injectable()
export class AiModelService {
  private readonly temperature = 0.7;
  private readonly maxTokens = 1200;

  constructor(private readonly configService: ConfigService) {}

  async generate(input: AiModelGenerateInput): Promise<AiModelGenerateResult> {
    const { model, chatModel } = this.createChatModel();

    const response = await chatModel.invoke(
      input.messages.map((message) => ({
        type: message.role,
        content: message.content,
      })),
    );
    const content = this.extractContent(response.content);

    return {
      content,
      model,
      usage: {
        usageMetadata: response.usage_metadata ?? null,
        responseMetadata: response.response_metadata ?? null,
      },
    };
  }

  async *stream(input: AiModelGenerateInput): AsyncGenerator<AiModelStreamChunk> {
    const { model, openai } = this.createOpenAiClient();

    const stream = await openai.chat.completions.create({
      model,
      messages: input.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        yield { delta, model };
      }

      if (chunk.usage) {
        yield {
          delta: "",
          model,
          usage: { usageMetadata: chunk.usage },
        };
      }
    }
  }

  private createOpenAiClient(): { model: string; openai: OpenAI } {
    const { apiKey, baseURL, model } = this.readModelConfig();

    return {
      model,
      openai: new OpenAI({
        apiKey,
        baseURL,
      }),
    };
  }

  private createChatModel(): { model: string; chatModel: ChatOpenAI } {
    const { apiKey, baseURL, model } = this.readModelConfig();

    return {
      model,
      chatModel: new ChatOpenAI({
        apiKey,
        model,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        configuration: { baseURL },
      }),
    };
  }

  private readModelConfig(): {
    apiKey: string;
    baseURL: string;
    model: string;
  } {
    const apiKey = this.configService.get<string>("app.aiOpenaiApiKey");
    const baseURL =
      this.configService.get<string>("app.aiOpenaiBaseUrl") ||
      "https://api.openai.com/v1";
    const model = this.configService.get<string>("app.aiOpenaiModel");

    if (!apiKey) {
      throw new ServiceUnavailableException("AI API Key 未配置");
    }
    if (!model) {
      throw new ServiceUnavailableException("AI 模型未配置");
    }

    return { apiKey, baseURL, model };
  }

  private extractContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (
          item &&
          typeof item === "object" &&
          "text" in item &&
          typeof item.text === "string"
        ) {
          return item.text;
        }
        return "";
      })
      .join("");
  }
}
