import { Module } from "@nestjs/common";
import { DocumentsModule } from "../../documents/documents.module";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { AgentDocumentService } from "./agent-document.service";

@Module({
  imports: [DocumentsModule, WorkspacesModule],
  providers: [AgentDocumentService],
  exports: [AgentDocumentService],
})
export class AgentDocumentModule {}
