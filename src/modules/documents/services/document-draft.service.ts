import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DocDraft } from "../../../entities/doc-draft.entity";

@Injectable()
export class DocumentDraftService {
  constructor(
    @InjectRepository(DocDraft)
    private readonly docDraftRepository: Repository<DocDraft>,
  ) {}

  async findByDocId(docId: string): Promise<DocDraft | null> {
    return this.docDraftRepository.findOne({ where: { docId } });
  }

  async discardDraft(docId: string) {
    await this.docDraftRepository.delete({ docId });
    return {
      docId,
      discarded: true,
      fallbackSource: "head" as const,
    };
  }
}
