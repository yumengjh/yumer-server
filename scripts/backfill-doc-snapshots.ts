import "reflect-metadata";
import "dotenv/config";
import { DataSource } from "typeorm";
import databaseConfig from "../src/config/database.config";
import { Block } from "../src/entities/block.entity";
import { BlockVersion } from "../src/entities/block-version.entity";
import { DocRevision } from "../src/entities/doc-revision.entity";
import { DocSnapshot } from "../src/entities/doc-snapshot.entity";
import { Document } from "../src/entities/document.entity";

async function main() {
  const config = databaseConfig() as any;
  const dataSource = new DataSource({
    ...config,
    synchronize: false,
    migrationsRun: false,
  });

  await dataSource.initialize();

  let created = 0;
  let skipped = 0;
  const revisionRepository = dataSource.getRepository(DocRevision);
  const snapshotRepository = dataSource.getRepository(DocSnapshot);
  const documentRepository = dataSource.getRepository(Document);
  const blockVersionRepository = dataSource.getRepository(BlockVersion);

  const revisions = await revisionRepository.find({
    order: { docId: "ASC", docVer: "ASC" },
  });

  for (const revision of revisions) {
    const existing = await snapshotRepository.findOne({
      where: { docId: revision.docId, docVer: revision.docVer },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const document = await documentRepository.findOne({
      where: { docId: revision.docId },
      select: ["docId", "rootBlockId"],
    });
    if (!document) {
      skipped += 1;
      continue;
    }

    const rows = await blockVersionRepository
      .createQueryBuilder("bv")
      .innerJoin(
        Block,
        "b",
        'bv.blockId = b.blockId AND (b."deletedAt" IS NULL OR b."deletedAt" > :cutoff)',
        {
          cutoff: revision.createdAt,
        },
      )
      .select("bv.blockId", "blockId")
      .addSelect("MAX(bv.ver)", "maxVer")
      .where("bv.docId = :docId", { docId: revision.docId })
      .andWhere("bv.createdAt <= :createdAt", { createdAt: revision.createdAt })
      .groupBy("bv.blockId")
      .getRawMany<{ blockId: string; maxVer: string | number }>();

    const blockVersionMap: Record<string, number> = {};
    for (const row of rows) {
      blockVersionMap[row.blockId] =
        typeof row.maxVer === "string" ? Number.parseInt(row.maxVer, 10) : row.maxVer;
    }

    const snapshot = snapshotRepository.create({
      snapshotId: `${revision.docId}@snap@${revision.docVer}`,
      docId: revision.docId,
      docVer: revision.docVer,
      createdAt: Date.now(),
      rootBlockId: document.rootBlockId,
      blockVersionMap,
      kind: "revision",
      pinned: false,
      retainUntil: null,
      metadata: {
        source: "backfill",
        revisionCreatedAt: revision.createdAt,
      },
    });

    await snapshotRepository.save(snapshot);
    created += 1;
  }

  console.log(JSON.stringify({ scanned: revisions.length, created, skipped }, null, 2));
  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
