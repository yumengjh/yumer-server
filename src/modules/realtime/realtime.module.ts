import { Module, forwardRef } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { DocumentRealtimeService } from "./document-realtime.service";
import { RealtimeController } from "./realtime.controller";

@Module({
  imports: [forwardRef(() => DocumentsModule)],
  controllers: [RealtimeController],
  providers: [DocumentRealtimeService],
  exports: [DocumentRealtimeService],
})
export class RealtimeModule {}
