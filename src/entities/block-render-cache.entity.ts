import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export type BlockRenderCacheStatus = "success" | "failed";

@Entity("block_render_caches")
@Index(["blockVersionId", "renderVersion"], { unique: true })
@Index(["docId"])
@Index(["blockId", "blockVer"])
export class BlockRenderCache {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  blockVersionId: number;

  @Column()
  docId: string;

  @Column()
  blockId: string;

  @Column()
  blockVer: number;

  @Column({ length: 80 })
  renderVersion: string;

  @Column({ type: "text", nullable: true })
  html: string | null;

  @Column({ type: "varchar", default: "success" })
  status: BlockRenderCacheStatus;

  @Column({ type: "text", nullable: true })
  error: string | null;

  @Column({ type: "bigint" })
  renderedAt: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
