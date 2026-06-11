import { firstValueFrom, filter, take } from "rxjs";
import { DocumentRealtimeService } from "./document-realtime.service";
import type { DocumentRemoteOpsEvent } from "./document-realtime.types";

function buildRemoteEvent(docId: string): DocumentRemoteOpsEvent {
  return {
    type: "document_remote_ops",
    eventId: `event_${docId}`,
    docId,
    serverHead: 1,
    previousDraftRevision: 0,
    draftRevision: 1,
    source: "autosync",
    originClientId: "client_1",
    originTabId: "tab_1",
    clientBatchId: "batch_1",
    operations: [
      {
        type: "update",
        blockId: "block_1",
        payload: { type: "paragraph" },
      },
    ],
    occurredAt: new Date(0).toISOString(),
  };
}

describe("DocumentRealtimeService", () => {
  it("publishes document events only to subscribers of the same document", async () => {
    const service = new DocumentRealtimeService();
    const doc1$ = service.subscribeDocument("doc_1", "user_1");
    const doc2$ = service.subscribeDocument("doc_2", "user_1");

    const received = firstValueFrom(
      doc1$.pipe(
        filter((message) => message.type === "document_remote_ops"),
        take(1),
      ),
    );
    const unexpected: unknown[] = [];
    const doc2Sub = doc2$
      .pipe(filter((message) => message.type === "document_remote_ops"))
      .subscribe((message) => unexpected.push(message));

    service.publishDocumentRemoteOps(buildRemoteEvent("doc_1"));

    await expect(received).resolves.toMatchObject({
      id: "event_doc_1",
      type: "document_remote_ops",
    });
    expect(unexpected).toEqual([]);
    expect(service.getSubscriberCount("doc_1")).toBe(0);

    doc2Sub.unsubscribe();
    service.onModuleDestroy();
  });
});
