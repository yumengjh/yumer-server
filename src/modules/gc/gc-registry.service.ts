import { Injectable } from "@nestjs/common";
import type { GcSubmoduleDescriptor } from "./contracts/gc-submodule.interface";
import { BlockVersionGcSubmodule } from "./modules/block-version/block-version-gc.submodule";
import { GcStorageSubmodule } from "./modules/storage/gc-storage.submodule";

type GcSubmoduleNode = GcSubmoduleDescriptor & {
  children: GcSubmoduleNode[];
};

@Injectable()
export class GcRegistryService {
  constructor(
    private readonly blockVersionGcSubmodule: BlockVersionGcSubmodule,
    private readonly gcStorageSubmodule: GcStorageSubmodule,
  ) {}

  listModules(): {
    items: GcSubmoduleDescriptor[];
    tree: GcSubmoduleNode[];
  } {
    const items = [
      this.blockVersionGcSubmodule.describe(),
      this.gcStorageSubmodule.describe(),
    ];

    return {
      items,
      tree: this.buildTree(items),
    };
  }

  private buildTree(items: GcSubmoduleDescriptor[]): GcSubmoduleNode[] {
    const nodes = new Map<string, GcSubmoduleNode>();

    for (const item of items) {
      nodes.set(item.key, {
        ...item,
        children: [],
      });
    }

    const roots: GcSubmoduleNode[] = [];
    for (const item of items) {
      const node = nodes.get(item.key);
      if (!node) {
        continue;
      }

      if (!item.parentKey) {
        roots.push(node);
        continue;
      }

      const parent = nodes.get(item.parentKey);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}
