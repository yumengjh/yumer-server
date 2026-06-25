import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import type { AiPromptMessage } from "./types/ai-message-role";

export interface AiModelGenerateInput {
  messages: AiPromptMessage[];
}

export interface AiModelGenerateResult {
  content: string;
  model: string;
  usage?: Record<string, unknown>;
}

@Injectable()
export class AiModelService {
  private readonly temperature = 0.7;
  private readonly maxTokens = 1200;

  constructor(private readonly configService: ConfigService) {}

  async generate(input: AiModelGenerateInput): Promise<AiModelGenerateResult> {
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

    const chatModel = new ChatOpenAI({
      apiKey,
      model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      configuration: { baseURL },
    });

    const response = await chatModel.invoke(
      input.messages.map((message) => ({
        type: message.role,
        content: message.content,
      })),
    );
    const content =
      typeof response.content === "string"
        ? response.content
        : response.content
            .map((item) =>
              typeof item === "string"
                ? item
                : "text" in item
                  ? String(item.text)
                  : "",
            )
            .join("");

    return {
      content,
      model,
      usage: {
        usageMetadata: response.usage_metadata ?? null,
        responseMetadata: response.response_metadata ?? null,
      },
    };
  }
}
