export type AiMessageRole = "system" | "user" | "assistant";

export interface AiPromptMessage {
  role: AiMessageRole;
  content: string;
}
