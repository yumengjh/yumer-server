import { AgentDocumentClientOperationType } from "./dto/agent-document-tool.dto";
import { AgentDocumentService } from "./agent-document.service";

describe("AgentDocumentService", () => {
  let documentsService: {
    assertAccessWithoutViewIncrement: jest.Mock;
  };
  let workspacesService: { checkEditPermission: jest.Mock };
  let service: AgentDocumentService;

  beforeEach(() => {
    documentsService = {
      assertAccessWithoutViewIncrement: jest.fn().mockResolvedValue({
        docId: "doc_1",
        workspaceId: "ws_1",
        title: "Doc",
        rootBlockId: "root_1",
        head: 3,
        draftRevision: 2,
      }),
    };
    workspacesService = {
      checkEditPermission: jest.fn().mockResolvedValue(undefined),
    };
    service = new AgentDocumentService(
      documentsService as never,
      workspacesService as never,
    );
  });

  it("authorizes an editable document target without opening an editor sync session", async () => {
    const result = await service.authorizeDocumentTarget(
      { docId: "doc_1" },
      "user_1",
    );

    expect(documentsService.assertAccessWithoutViewIncrement).toHaveBeenCalledWith(
      "doc_1",
      "user_1",
    );
    expect(workspacesService.checkEditPermission).toHaveBeenCalledWith(
      "ws_1",
      "user_1",
    );
    expect(result).toMatchObject({
        docId: "doc_1",
      workspaceId: "ws_1",
      head: 3,
      draftRevision: 2,
    });
  });

  it("creates a browser-editor proposal without mutating blocks or drafts", async () => {
    const result = await service.createClientProposal(
      {
        docId: "doc_1",
        instruction: "优化第一段",
        clientContext: {
          docId: "doc_1",
          head: 3,
          draftRevision: 2,
          selectionBlockId: "b_1",
        },
        operations: [
          {
            type: AgentDocumentClientOperationType.UPDATE_BLOCK,
            blockId: "b_1",
            payload: { text: "AI edit" },
          },
        ],
      },
      "user_1",
    );

    expect(result).toMatchObject({
      proposalId: expect.stringMatching(/^aidp_/),
      docId: "doc_1",
      workspaceId: "ws_1",
      applyTarget: "browser-editor",
      status: "pending_client_apply",
      instruction: "优化第一段",
      base: {
        head: 3,
        draftRevision: 2,
        selectionBlockId: "b_1",
      },
      server: {
        head: 3,
        draftRevision: 2,
      },
      warnings: [],
    });
    expect(result.operations).toEqual([
      {
        type: AgentDocumentClientOperationType.UPDATE_BLOCK,
        blockId: "b_1",
        payload: { text: "AI edit" },
      },
    ]);
  });

  it("warns when the frontend context is older than the server document", async () => {
    const result = await service.createClientProposal(
      {
        docId: "doc_1",
        instruction: "继续编辑",
        clientContext: { docId: "doc_1", head: 2, draftRevision: 1 },
        operations: [
          {
            type: AgentDocumentClientOperationType.REPLACE_SELECTION,
            payload: { text: "AI edit" },
          },
        ],
      },
      "user_1",
    );

    expect(result.warnings).toEqual([
      "CLIENT_HEAD_DIFFERS_FROM_SERVER_HEAD",
      "CLIENT_DRAFT_DIFFERS_FROM_SERVER_DRAFT",
    ]);
  });
});
