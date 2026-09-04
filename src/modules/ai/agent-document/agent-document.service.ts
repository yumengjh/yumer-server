import { Injectable } from "@nestjs/common";
import { randomBytes } from "crypto";
import { DocumentsService } from "../../documents/documents.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import {
  AgentDocumentContextDto,
  AgentDocumentProposalDto,
} from "./dto/agent-document-tool.dto";

export type AgentDocumentTarget = {
  docId: string;
  workspaceId: string;
  title: string;
  rootBlockId: string;
  head: number;
  draftRevision: number;
};

export type AgentDocumentClientProposal = {
  proposalId: string;
  docId: string;
  workspaceId: string;
  applyTarget: "browser-editor";
  status: "pending_client_apply";
  instruction: string;
  base: {
    head: number;
    draftRevision: number;
    selectionBlockId?: string;
  };
  server: {
    head: number;
    draftRevision: number;
  };
  operations: AgentDocumentProposalDto["operations"];
  warnings: string[];
  createdAt: string;
};

@Injectable()
export class AgentDocumentService {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async authorizeDocumentTarget(
    dto: AgentDocumentContextDto,
    userId: string,
  ): Promise<AgentDocumentTarget> {
    const document = await this.documentsService.assertAccessWithoutViewIncrement(
      dto.docId,
      userId,
    );
    await this.workspacesService.checkEditPermission(document.workspaceId, userId);

    return {
      docId: document.docId,
      workspaceId: document.workspaceId,
      title: document.title,
      rootBlockId: document.rootBlockId,
      head: document.head,
      draftRevision: document.draftRevision ?? 0,
    };
  }

  async createClientProposal(
    dto: AgentDocumentProposalDto,
    userId: string,
  ): Promise<AgentDocumentClientProposal> {
    const target = await this.authorizeDocumentTarget({ docId: dto.docId }, userId);
    const warnings = this.buildClientContextWarnings(dto, target);

    return {
      proposalId: this.generateProposalId(),
      docId: target.docId,
      workspaceId: target.workspaceId,
      applyTarget: "browser-editor",
      status: "pending_client_apply",
      instruction: dto.instruction,
      base: {
        head: dto.clientContext?.head ?? target.head,
        draftRevision: dto.clientContext?.draftRevision ?? target.draftRevision,
        ...(dto.clientContext?.selectionBlockId
          ? { selectionBlockId: dto.clientContext.selectionBlockId }
          : {}),
      },
      server: {
        head: target.head,
        draftRevision: target.draftRevision,
      },
      operations: dto.operations,
      warnings,
      createdAt: new Date().toISOString(),
    };
  }

  private buildClientContextWarnings(
    dto: AgentDocumentProposalDto,
    target: AgentDocumentTarget,
  ): string[] {
    const warnings: string[] = [];
    const context = dto.clientContext;
    if (!context) {
      warnings.push("CLIENT_CONTEXT_MISSING");
      return warnings;
    }
    if (context.head !== target.head) {
      warnings.push("CLIENT_HEAD_DIFFERS_FROM_SERVER_HEAD");
    }
    if (
      typeof context.draftRevision === "number" &&
      context.draftRevision !== target.draftRevision
    ) {
      warnings.push("CLIENT_DRAFT_DIFFERS_FROM_SERVER_DRAFT");
    }
    return warnings;
  }

  private generateProposalId(): string {
    return `aidp_${Date.now()}_${randomBytes(6).toString("hex")}`;
  }
}
