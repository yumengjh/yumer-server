import type { DataSource, Repository } from 'typeorm';
import type { Document } from '../../../entities/document.entity';
import type { DocRevision } from '../../../entities/doc-revision.entity';
import { VersionControlService } from './version-control.service';

describe('VersionControlService', () => {
  let service: VersionControlService;

  beforeEach(() => {
    const documentRepository = {} as Repository<Document>;
    const docRevisionRepository = {} as Repository<DocRevision>;
    const dataSource = {
      transaction: jest.fn(),
    } as unknown as DataSource;

    service = new VersionControlService(documentRepository, docRevisionRepository, dataSource);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('returns pending draft state from in-memory counter', () => {
    service.recordPendingVersion('doc_1');
    service.recordPendingVersion('doc_1');

    expect(service.getPendingDraftState('doc_1')).toEqual({
      pendingCount: 2,
      hasPendingDraft: true,
    });
  });

  it('returns empty draft state for unknown doc', () => {
    expect(service.getPendingDraftState('missing_doc')).toEqual({
      pendingCount: 0,
      hasPendingDraft: false,
    });
  });
});
