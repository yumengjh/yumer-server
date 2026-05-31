import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { randomBytes } from "crypto";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ANCHOR_LENGTH = 6;

function generateAnchorId(): string {
  const bytes = randomBytes(ANCHOR_LENGTH);
  let result = "";
  for (let i = 0; i < ANCHOR_LENGTH; i++) {
    result += LETTERS[bytes[i] % 52];
  }
  return result;
}
import StarterKit from "@tiptap/starter-kit";
import CodeBlock from "@tiptap/extension-code-block";
import Code from "@tiptap/extension-code";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Strike from "@tiptap/extension-strike";
import Underline from "@tiptap/extension-underline";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";

const DEFAULT_LIST_FONT_SIZE_PX = 15;

const BLOCK_IDENTITY_NODE_TYPES = [
  "paragraph",
  "heading",
  "codeBlock",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "table",
  "horizontalRule",
  "listItem",
  "taskItem",
  "tableCell",
  "tableHeader",
  "highlightBlock",
];

const createFontSizeExtension = () =>
  Extension.create({
    name: "fontSize",
    addOptions() {
      return {
        types: ["textStyle"],
      };
    },
    addGlobalAttributes() {
      return [
        {
          types: this.options.types,
          attributes: {
            fontSize: {
              default: null,
              renderHTML: (attributes: Record<string, unknown>) => {
                if (!attributes.fontSize) {
                  return {};
                }
                return { style: `font-size: ${attributes.fontSize}px` };
              },
            },
          },
        },
      ];
    },
  });

export type TiptapJsonNode = {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: TiptapJsonNode[];
};

function normalizeFontSize(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const text = `${value}`.trim();
  if (!text) return null;
  if (text.endsWith("px")) return text;
  return /^\d+(\.\d+)?$/.test(text) ? `${text}px` : null;
}

function findListContentFontSizeFromJson(node: TiptapJsonNode): string | null {
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const nested = findListContentFontSizeFromJson(child);
      if (nested) return nested;
    }
  }

  if (!Array.isArray(node.marks)) return null;

  for (const mark of node.marks) {
    if (mark.type !== "textStyle") continue;
    const normalized = normalizeFontSize(mark.attrs?.fontSize);
    if (normalized) return normalized;
  }

  return null;
}

function buildListTypographyVars(fontSize: string): Record<string, string> {
  const fontSizeNumber = Number.parseFloat(fontSize);
  const scale = Number.isFinite(fontSizeNumber)
    ? Math.max(1, fontSizeNumber / DEFAULT_LIST_FONT_SIZE_PX)
    : 1;

  return {
    "--list-font-size": fontSize,
    "--task-checkbox-size": `${Math.round(16 * scale * 100) / 100}px`,
    "--task-checkbox-offset": `${Math.round(fontSizeNumber * 1.74 * 100) / 100}px`,
    "--task-checkbox-gap": `${Math.round(12 * scale * 100) / 100}px`,
    "--task-checkmark-width": `${Math.round(4 * scale * 100) / 100}px`,
    "--task-checkmark-height": `${Math.round(8 * scale * 100) / 100}px`,
    "--task-checkmark-left": `${Math.round(4.5 * scale * 100) / 100}px`,
    "--task-checkmark-top": `${Math.round(1 * scale * 100) / 100}px`,
    "--task-checkmark-border": `${Math.round(2 * scale * 100) / 100}px`,
    "--task-checkbox-radius": `${Math.round(6 * scale * 100) / 100}px`,
    "--task-check-stroke": `${Math.round(4 * scale * 100) / 100}px`,
    "--task-check-length": `${Math.round(100 * scale * 100) / 100}`,
  };
}

function serializeVars(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
}

export function attachListTypographyAttrs<T extends TiptapJsonNode>(node: T): T {
  const content = Array.isArray(node.content)
    ? node.content.map((child) => attachListTypographyAttrs(child))
    : node.content;

  let attrs = node.attrs;
  if (node.type === "listItem" || node.type === "taskItem") {
    const fontSize = findListContentFontSizeFromJson({ ...node, content });
    if (fontSize) {
      const vars = buildListTypographyVars(fontSize);
      attrs = {
        ...(attrs ?? {}),
        dataListFontSize: fontSize,
        listTypographyStyle: serializeVars(vars),
      };
    }
  }

  return {
    ...node,
    ...(content ? { content } : {}),
    ...(attrs ? { attrs } : {}),
  };
}

const DisplayListTypography = Extension.create({
  name: "displayListTypography",
  addGlobalAttributes() {
    return [
      {
        types: ["listItem", "taskItem"],
        attributes: {
          dataListFontSize: {
            default: null,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.dataListFontSize
                ? { "data-list-font-size": attributes.dataListFontSize }
                : {},
          },
          listTypographyStyle: {
            default: null,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.listTypographyStyle
                ? { style: attributes.listTypographyStyle }
                : {},
          },
        },
      },
    ];
  },
});

const SerializedTaskItem = TaskItem.configure({ nested: true }).extend({
  renderHTML({ node, HTMLAttributes }) {
    return [
      "li",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": this.name,
      }),
      [
        "div",
        { class: "checkbox-wrapper" },
        [
          "input",
          {
            type: "checkbox",
            class: "check task-item-checkbox-input",
            ...(node.attrs.checked ? { checked: "checked" } : {}),
          },
        ],
        [
          "label",
          { class: "label task-item-checkbox" },
          [
            "svg",
            { class: "task-item-checkbox-svg", viewBox: "0 0 95 95", "aria-hidden": "true" },
            [
              "rect",
              {
                x: "30",
                y: "20",
                width: "50",
                height: "50",
                fill: "none",
                class: "task-item-checkbox-box",
              },
            ],
            [
              "g",
              { transform: "translate(0,-952.36222)" },
              [
                "path",
                {
                  d: "m 56,963 c -102,122 6,9 7,9 17,-5 -66,69 -38,52 122,-77 -7,14 18,4 29,-11 45,-43 23,-4",
                  fill: "none",
                  class: "path1 task-item-check-path",
                },
              ],
            ],
          ],
        ],
      ],
      ["div", 0],
    ];
  },
});

const OrderedListStyle = Node.create({
  name: "orderedListStyle",
  addOptions() {
    return {
      types: ["orderedList"],
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          listStyleType: {
            default: "decimal",
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.listStyleType || attributes.listStyleType === "decimal") {
                return {};
              }
              return { style: `list-style-type: ${attributes.listStyleType}` };
            },
          },
        },
      },
    ];
  },
});

const LineHeight = Extension.create({
  name: "lineHeight",
  addOptions() {
    return {
      types: ["paragraph", "heading"],
      defaultLineHeight: null,
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: this.options.defaultLineHeight,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.lineHeight) {
                return {};
              }
              return { style: `line-height: ${attributes.lineHeight}` };
            },
          },
        },
      },
    ];
  },
});

const HighlightBlock = Node.create({
  name: "highlightBlock",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      backgroundColor: {
        default: "#FFF2CC",
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.backgroundColor) {
            return {};
          }
          return { style: `background-color: ${attributes.backgroundColor}` };
        },
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-highlight-block": "" }), 0];
  },
});

const Indent = Extension.create({
  name: "indent",
  addOptions() {
    return {
      types: ["paragraph", "heading"],
      maxLevel: 8,
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            renderHTML: (attributes: Record<string, unknown>) => {
              const indent = Number(attributes.indent ?? 0);
              if (!indent || indent <= 0) {
                return {};
              }
              return { style: `padding-left: ${Math.min(indent, this.options.maxLevel)}em` };
            },
          },
        },
      },
    ];
  },
});

const HeadingAnchorId = Extension.create({
  name: "headingAnchorId",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          anchorId: {
            default: null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const anchorId = (attributes.anchorId as string) || generateAnchorId();
              return { id: anchorId };
            },
          },
        },
      },
    ];
  },
});

const BlockIdAttribute = Extension.create({
  name: "blockIdAttribute",
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_IDENTITY_NODE_TYPES,
        attributes: {
          blockId: {
            default: null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const blockId = attributes.blockId ?? attributes["data-block-id"];
              if (!blockId) {
                return {};
              }
              return {
                blockId,
                "data-block-id": blockId,
              };
            },
          },
          clientId: {
            default: null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const clientId = attributes.clientId ?? attributes["data-client-id"];
              if (!clientId) {
                return {};
              }
              return {
                clientId,
                "data-client-id": clientId,
              };
            },
          },
        },
      },
    ];
  },
});

export const tiptapSerializationExtensions = [
  StarterKit.configure({
    codeBlock: false,
    code: false,
    bold: false,
    italic: false,
    strike: false,
    horizontalRule: false,
    link: false,
    underline: false,
    heading: { levels: [1, 2, 3, 4, 5, 6] },
  }),
  CodeBlock,
  Code.extend({ excludes: "" }),
  Bold,
  Italic,
  Strike,
  HorizontalRule,
  Underline,
  TaskList,
  SerializedTaskItem,
  Link.configure({ openOnClick: false }),
  TextStyle,
  DisplayListTypography,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
  createFontSizeExtension(),
  OrderedListStyle,
  LineHeight.configure({ types: ["paragraph", "heading"], defaultLineHeight: null }),
  HighlightBlock,
  Indent.configure({ types: ["paragraph", "heading"], maxLevel: 8 }),
  BlockIdAttribute,
  HeadingAnchorId,
];
