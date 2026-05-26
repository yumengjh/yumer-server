import { DocDraft } from "../../../entities/doc-draft.entity";

describe("DocDraft entity wiring", () => {
  it("stores one shared draft per document", () => {
    const draft = new DocDraft();
    draft.docId = "doc_1";
    draft.workspaceId = "ws_1";
    draft.rootBlockId = "root_1";
    draft.baseDocVer = 3;
    draft.blockVersionMap = { root_1: 1, b_1: 4 };
    draft.changedBlocksCount = 1;

    expect(draft.docId).toBe("doc_1");
    expect(draft.blockVersionMap).toEqual({ root_1: 1, b_1: 4 });
  });
});
