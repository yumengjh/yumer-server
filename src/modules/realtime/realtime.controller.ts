import { Controller, Param, Sse, UseGuards } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { Observable } from "rxjs";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { DocumentsService } from "../documents/documents.service";
import { DocumentRealtimeService } from "./document-realtime.service";

@Controller("realtime")
@UseGuards(JwtAuthGuard)
export class RealtimeController {
  constructor(
    private readonly realtime: DocumentRealtimeService,
    private readonly documentsService: DocumentsService,
  ) {}

  @Sse("documents/:docId/events")
  async documentEvents(
    @Param("docId") docId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<Observable<MessageEvent>> {
    await this.documentsService.assertAccessWithoutViewIncrement(docId, user.userId);
    return this.realtime.subscribeDocument(docId, user.userId);
  }
}
