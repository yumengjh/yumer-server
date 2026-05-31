import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { BlockRenderCache } from "../../../entities/block-render-cache.entity";
import { DocumentHtmlRendererService } from "./document-html-renderer.service";

export const DOCUMENT_RENDER_VERSION = "tiptap-static-v4";

export const CLIENT_RENDERED_BLOCK_TYPES: Record<string, true> = {
  codeBlock: true,
};

export type RenderTreeNode = {
  blockId: string;
  type: string;
  blockVersionId?: number;
  docId?: string;
  ver?: number;
  payload?: object;
  html?: string;
  children?: RenderTreeNode[];
  [key: string]: unknown;
};

export type RenderFailure = {
  blockId: string;
  blockVersionId: number;
  error: string;
};

export type DocumentRenderDiagnostics = {
  renderVersion: string;
  renderMode: "json" | "cache" | "fresh" | "cache-fresh" | "mixed" | "client-json";
  cache: "none" | "hit" | "miss" | "mixed";
  totalBlocks: number;
  renderableBlocks: number;
  cachedBlocks: number;
  freshBlocks: number;
  clientBlocks: number;
  failedBlocks: number;
};

type MutableRenderDiagnostics = Omit<DocumentRenderDiagnostics, "renderMode" | "cache">;

@Injectable()
export class DocumentRenderService {
  private readonly logger = new Logger(DocumentRenderService.name);

  constructor(
    @InjectRepository(BlockRenderCache)
    private readonly cacheRepository: Repository<BlockRenderCache>,
    private readonly htmlRenderer: DocumentHtmlRendererService,
  ) {}

  async renderTree(
    tree: RenderTreeNode,
  ): Promise<{
    tree: RenderTreeNode;
    failures: RenderFailure[];
    diagnostics: DocumentRenderDiagnostics;
  }> {
    const renderableNodes = this.collectRenderableNodes(tree);
    const diagnostics = this.createDiagnostics(tree, renderableNodes.length);
    if (renderableNodes.length === 0) {
      return { tree, failures: [], diagnostics: this.finalizeDiagnostics(diagnostics) };
    }

    const blockVersionIds = renderableNodes.map((node) => node.blockVersionId as number);
    const cachedRows = await this.cacheRepository.find({
      where: {
        blockVersionId: In(blockVersionIds),
        renderVersion: DOCUMENT_RENDER_VERSION,
      },
    });
    const cacheByBlockVersionId = new Map<number, BlockRenderCache>();
    for (const row of cachedRows) {
      cacheByBlockVersionId.set(row.blockVersionId, row);
    }

    const cacheWrites: BlockRenderCache[] = [];
    const failures: RenderFailure[] = [];
    const renderedTree = this.renderNode(
      tree,
      cacheByBlockVersionId,
      cacheWrites,
      failures,
      diagnostics,
    );

    if (cacheWrites.length > 0) {
      try {
        await this.cacheRepository.save(cacheWrites);
      } catch (error) {
        this.logger.warn(
          `块级 HTML 缓存回填失败: count=${cacheWrites.length}, error=${this.formatError(error)}`,
        );
      }
    }

    return {
      tree: renderedTree,
      failures,
      diagnostics: this.finalizeDiagnostics(diagnostics),
    };
  }

  private collectRenderableNodes(tree: RenderTreeNode): RenderTreeNode[] {
    const nodes: RenderTreeNode[] = [];
    const walk = (node: RenderTreeNode) => {
      if (this.canRenderOnServer(node)) {
        nodes.push(node);
      }
      for (const child of node.children ?? []) {
        walk(child);
      }
    };
    walk(tree);
    return nodes;
  }

  private renderNode(
    node: RenderTreeNode,
    cacheByBlockVersionId: Map<number, BlockRenderCache>,
    cacheWrites: BlockRenderCache[],
    failures: RenderFailure[],
    diagnostics: MutableRenderDiagnostics,
  ): RenderTreeNode {
    const children = (node.children ?? []).map((child) =>
      this.renderNode(child, cacheByBlockVersionId, cacheWrites, failures, diagnostics),
    );
    const nextNode: RenderTreeNode = { ...node, children };

    if (!this.canRenderOnServer(node)) {
      return nextNode;
    }

    const blockVersionId = node.blockVersionId as number;
    const cached = cacheByBlockVersionId.get(blockVersionId);
    if (cached?.status === "success" && cached.html) {
      diagnostics.cachedBlocks++;
      return { ...nextNode, html: cached.html };
    }

    try {
      const rawHtml = this.htmlRenderer.renderBlock(node as { payload: object });
      const html = this.injectHeadingAnchorId(
        this.htmlRenderer.sanitize(rawHtml),
        node.payload,
      );
      diagnostics.freshBlocks++;
      cacheWrites.push(
        this.cacheRepository.create({
          ...(cached?.id ? { id: cached.id } : {}),
          blockVersionId,
          docId: node.docId ?? "",
          blockId: node.blockId,
          blockVer: node.ver ?? 0,
          renderVersion: DOCUMENT_RENDER_VERSION,
          html,
          status: "success",
          error: null,
          renderedAt: Date.now(),
        }),
      );
      return { ...nextNode, html };
    } catch (error) {
      const message = this.formatError(error);
      diagnostics.failedBlocks++;
      failures.push({ blockId: node.blockId, blockVersionId, error: message });
      cacheWrites.push(
        this.cacheRepository.create({
          ...(cached?.id ? { id: cached.id } : {}),
          blockVersionId,
          docId: node.docId ?? "",
          blockId: node.blockId,
          blockVer: node.ver ?? 0,
          renderVersion: DOCUMENT_RENDER_VERSION,
          html: null,
          status: "failed",
          error: message,
          renderedAt: Date.now(),
        }),
      );
      this.logger.warn(
        `块级 HTML 渲染失败: blockId=${node.blockId}, blockVersionId=${blockVersionId}, error=${message}`,
      );
      return nextNode;
    }
  }

  private injectHeadingAnchorId(html: string, payload?: object): string {
    if (!payload || typeof payload !== "object") return html;
    const p = payload as Record<string, unknown>;
    if (p.type !== "heading" || !p.attrs) return html;
    const attrs = p.attrs as Record<string, unknown>;
    if (!attrs.anchorId) return html;
    const tag = `h${attrs.level || 1}`;
    return html.replace(
      new RegExp(`^(<${tag})(\\s|>)`, "i"),
      `$1 id="${attrs.anchorId}"$2`,
    );
  }

  private canRenderOnServer(node: RenderTreeNode): boolean {
    if (node.type === "root") {
      return false;
    }
    if (CLIENT_RENDERED_BLOCK_TYPES[node.type]) {
      return false;
    }
    return typeof node.blockVersionId === "number" && !!node.payload;
  }

  private createDiagnostics(
    tree: RenderTreeNode,
    renderableBlocks: number,
  ): MutableRenderDiagnostics {
    let totalBlocks = 0;
    let clientBlocks = 0;

    const walk = (node: RenderTreeNode) => {
      if (node.type !== "root") {
        totalBlocks++;
        if (CLIENT_RENDERED_BLOCK_TYPES[node.type]) {
          clientBlocks++;
        }
      }

      for (const child of node.children ?? []) {
        walk(child);
      }
    };

    walk(tree);

    return {
      renderVersion: DOCUMENT_RENDER_VERSION,
      totalBlocks,
      renderableBlocks,
      cachedBlocks: 0,
      freshBlocks: 0,
      clientBlocks,
      failedBlocks: 0,
    };
  }

  private finalizeDiagnostics(
    diagnostics: MutableRenderDiagnostics,
  ): DocumentRenderDiagnostics {
    const htmlBlocks = diagnostics.cachedBlocks + diagnostics.freshBlocks;
    const cache = this.resolveCacheState(diagnostics);
    let renderMode: DocumentRenderDiagnostics["renderMode"];

    if (diagnostics.clientBlocks > 0 && htmlBlocks > 0) {
      renderMode = "mixed";
    } else if (diagnostics.clientBlocks > 0) {
      renderMode = "client-json";
    } else if (diagnostics.cachedBlocks > 0 && diagnostics.freshBlocks > 0) {
      renderMode = "cache-fresh";
    } else if (diagnostics.cachedBlocks > 0) {
      renderMode = "cache";
    } else if (diagnostics.freshBlocks > 0) {
      renderMode = "fresh";
    } else {
      renderMode = "json";
    }

    return {
      ...diagnostics,
      renderMode,
      cache,
    };
  }

  private resolveCacheState(
    diagnostics: MutableRenderDiagnostics,
  ): DocumentRenderDiagnostics["cache"] {
    if (diagnostics.renderableBlocks === 0) {
      return "none";
    }
    if (diagnostics.cachedBlocks > 0 && diagnostics.freshBlocks > 0) {
      return "mixed";
    }
    if (diagnostics.cachedBlocks === diagnostics.renderableBlocks) {
      return "hit";
    }
    if (diagnostics.freshBlocks > 0 || diagnostics.failedBlocks > 0) {
      return "miss";
    }
    return "none";
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
