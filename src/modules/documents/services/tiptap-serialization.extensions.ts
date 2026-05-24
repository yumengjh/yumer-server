import { Extension, Node, mergeAttributes } from "@tiptap/core";
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
  TaskItem.configure({ nested: true }),
  Link.configure({ openOnClick: false }),
  TextStyle,
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
];
