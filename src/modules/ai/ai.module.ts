import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AiContextSnapshot } from "../../entities/ai-context-snapshot.entity";
import { AiConversation } from "../../entities/ai-conversation.entity";
import { AiMessage } from "../../entities/ai-message.entity";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AiController } from "./ai.controller";
import { AiConversationService } from "./ai-conversation.service";
import { AiModelService } from "./ai-model.service";
import { AiPromptBuilder } from "./ai-prompt-builder";
import { AgentDocumentModule } from "./agent-document/agent-document.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([AiConversation, AiMessage, AiContextSnapshot]),
    WorkspacesModule,
    AgentDocumentModule,
  ],
  controllers: [AiController],
  providers: [AiConversationService, AiModelService, AiPromptBuilder],
  exports: [AiConversationService, AiModelService, AgentDocumentModule],
})
export class AiModule {}
