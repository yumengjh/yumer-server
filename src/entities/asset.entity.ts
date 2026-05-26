import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { isSqlite } from "../common/db-type";
import type { User } from "./user.entity";
import type { Workspace } from "./workspace.entity";

@Entity("assets")
@Index(["workspaceId"])
export class Asset {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  assetId: string;

  @ManyToOne("Workspace", "assets")
  @JoinColumn({ name: "workspace_id", referencedColumnName: "workspaceId" })
  workspace: Workspace;

  @Column()
  workspaceId: string;

  @ManyToOne("User")
  @JoinColumn({ name: "uploaded_by", referencedColumnName: "userId" })
  uploadedByUser: User;

  @Column()
  uploadedBy: string;

  @Column()
  filename: string;

  @Column()
  mimeType: string;

  @Column({ type: "bigint" })
  size: number;

  @Column()
  storageProvider: string;

  @Column()
  storagePath: string;

  @Column()
  url: string;

  @Column({ type: "integer", nullable: true })
  width: number | null;

  @Column({ type: "integer", nullable: true })
  height: number | null;

  @Column({ nullable: true })
  thumbnail: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ default: "active" })
  status: string;

  @Column({ default: 0 })
  refCount: number;

  @Column({
    type: isSqlite() ? "simple-json" : "jsonb",
    default: () => (isSqlite() ? "'[]'" : "'[]'"),
  })
  refs: object[];
}
