import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Observable, Subject, finalize } from "rxjs";
import { randomUUID } from "node:crypto";
import type { MessageEvent } from "@nestjs/common";
import type {
  DocumentRemoteOpsEvent,
  DocumentReloadRequiredEvent,
  RealtimeHeartbeatEvent,
  RealtimeSseEvent,
} from "./document-realtime.types";

type DocumentSubscriber = {
  id: string;
  userId: string;
  docId: string;
  subject: Subject<MessageEvent>;
  connectedAt: number;
  heartbeatTimer: NodeJS.Timeout;
};

@Injectable()
export class DocumentRealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(DocumentRealtimeService.name);
  private readonly subscribersByDocId = new Map<string, Map<string, DocumentSubscriber>>();
  private readonly heartbeatMs = 25_000;

  subscribeDocument(docId: string, userId: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    const subscriberId = randomUUID();
    const subscriber: DocumentSubscriber = {
      id: subscriberId,
      userId,
      docId,
      subject,
      connectedAt: Date.now(),
      heartbeatTimer: setInterval(() => {
        this.emitToSubscriber(subscriber, this.createHeartbeat(docId));
      }, this.heartbeatMs),
    };

    const subscribers = this.subscribersByDocId.get(docId) ?? new Map();
    subscribers.set(subscriberId, subscriber);
    this.subscribersByDocId.set(docId, subscribers);

    this.emitToSubscriber(subscriber, this.createHeartbeat(docId));
    this.logger.debug(`realtime subscriber connected docId=${docId} subscriber=${subscriberId}`);

    return subject.asObservable().pipe(
      finalize(() => {
        clearInterval(subscriber.heartbeatTimer);
        const current = this.subscribersByDocId.get(docId);
        current?.delete(subscriberId);
        if (current && current.size === 0) {
          this.subscribersByDocId.delete(docId);
        }
        this.logger.debug(`realtime subscriber disconnected docId=${docId} subscriber=${subscriberId}`);
      }),
    );
  }

  publishDocumentRemoteOps(event: DocumentRemoteOpsEvent): void {
    this.publish(event.docId, event);
  }

  publishDocumentReloadRequired(event: DocumentReloadRequiredEvent): void {
    this.publish(event.docId, event);
  }

  getSubscriberCount(docId: string): number {
    return this.subscribersByDocId.get(docId)?.size ?? 0;
  }

  onModuleDestroy(): void {
    for (const subscribers of this.subscribersByDocId.values()) {
      for (const subscriber of subscribers.values()) {
        clearInterval(subscriber.heartbeatTimer);
        subscriber.subject.complete();
      }
    }
    this.subscribersByDocId.clear();
  }

  private publish(docId: string, event: RealtimeSseEvent): void {
    const subscribers = this.subscribersByDocId.get(docId);
    if (!subscribers || subscribers.size === 0) return;
    for (const subscriber of subscribers.values()) {
      this.emitToSubscriber(subscriber, event);
    }
  }

  private emitToSubscriber(subscriber: DocumentSubscriber, event: RealtimeSseEvent): void {
    try {
      subscriber.subject.next({
        id: event.eventId,
        type: event.type,
        data: event,
      });
    } catch (error) {
      this.logger.debug(
        `realtime emit failed docId=${subscriber.docId} subscriber=${subscriber.id} error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      subscriber.subject.complete();
    }
  }

  private createHeartbeat(docId: string): RealtimeHeartbeatEvent {
    return {
      type: "heartbeat",
      eventId: `heartbeat:${docId}:${Date.now()}`,
      docId,
      occurredAt: new Date().toISOString(),
    };
  }
}
