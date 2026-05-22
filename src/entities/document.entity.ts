import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from "typeorm";
import { isSqlite } from "../common/db-type";

@Entity("documents")
@Index(["workspaceId", "status"])
@Index(["updatedAt"])
export class Document {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  docId: string;

  @ManyToOne("Workspace", "documents")
  @JoinColumn({ name: "workspace_id", referencedColumnName: "workspaceId" })
  workspace: any;

  @Column()
  workspaceId: string;

  @Column()
  title: string;

  @Column({ nullable: true })
  icon: string;

  @Column({ nullable: true })
  cover: string;

  @Column({ default: 1 })
  head: number;

  @Column({ default: 0 })
  publishedHead: number;

  @Column({ type: "varchar", nullable: true })
  publishedSnapshotId: string | null;

  @Column()
  rootBlockId: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column()
  createdBy: string;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column()
  updatedBy: string;

  @Column({ default: "draft" })
  status: string;

  @Column({ default: "private" })
  visibility: string;

  @Column({ nullable: true })
  parentId: string;

  @Column({ default: 0 })
  sortOrder: number;

  @Column({ default: 0 })
  viewCount: number;

  @Column({ default: 0 })
  favoriteCount: number;

  @Column({
    type: isSqlite() ? "simple-json" : "text",
    array: !isSqlite(),
    default: () => (isSqlite() ? "'[]'" : "'{}'"),
  })
  tags: string[];

  @Column({ nullable: true })
  category: string;

  @Column({ type: isSqlite() ? "simple-json" : "tsvector", nullable: true })
  searchVector: any;

  // 关联
  @OneToMany("Block", "document")
  blocks: any[];

  @OneToMany("DocRevision", "document")
  revisions: any[];

  @OneToMany("Favorite", "document")
  favorites: any[];

  @OneToMany("Comment", "document")
  comments: any[];
}
