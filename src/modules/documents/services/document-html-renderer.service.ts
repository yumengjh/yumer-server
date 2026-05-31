import { Injectable } from "@nestjs/common";
import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import sanitizeHtml from "sanitize-html";
import {
  attachListTypographyAttrs,
  type TiptapJsonNode,
  tiptapSerializationExtensions,
} from "./tiptap-serialization.extensions";

@Injectable()
export class DocumentHtmlRendererService {
  renderBlock(block: { payload: object }): string {
    if (this.isLegacyHtmlPayload(block.payload)) {
      return block.payload.html;
    }

    return renderToHTMLString({
      extensions: tiptapSerializationExtensions,
      content: {
        type: "doc",
        content: [attachListTypographyAttrs(block.payload as TiptapJsonNode)],
      },
    });
  }

  sanitize(html: string): string {
    return sanitizeHtml(html, {
      parser: {
        lowerCaseAttributeNames: false,
      },
      allowedTags: [
        ...sanitizeHtml.defaults.allowedTags,
        "img",
        "span",
        "pre",
        "code",
        "mark",
        "u",
        "s",
        "hr",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "label",
        "input",
        "svg",
        "rect",
        "g",
        "path",
      ],
      allowedAttributes: {
        "*": [
          "class",
          "style",
          "data-*",
          "blockId",
          "clientId",
          "data-block-id",
          "data-client-id",
          "data-highlight-block",
        ],
        a: ["href", "name", "target", "rel", "title"],
        img: ["src", "alt", "title", "width", "height", "loading"],
        input: ["type", "checked", "disabled"],
        svg: ["viewBox", "aria-hidden"],
        rect: ["x", "y", "width", "height", "fill"],
        g: ["transform"],
        path: ["d", "fill"],
        th: ["colspan", "rowspan"],
        td: ["colspan", "rowspan"],
        h1: ["id"],
        h2: ["id"],
        h3: ["id"],
        h4: ["id"],
        h5: ["id"],
        h6: ["id"],
      },
      allowedSchemes: ["http", "https", "mailto", "tel"],
      allowedStyles: {
        "*": {
          color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(/, /^rgba\(/],
          "background-color": [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(/, /^rgba\(/],
          "font-size": [/^\d+(\.\d+)?(px|em|rem|%)$/],
          "line-height": [/^\d+(\.\d+)?(px|em|rem|%)?$/],
          "padding-left": [/^\d+(\.\d+)?(px|em|rem|%)$/],
          "list-style-type": [/^[a-zA-Z-]+$/],
          "text-align": [/^(left|right|center|justify)$/],
          "--list-font-size": [/^\d+(\.\d+)?px$/],
          "--task-checkbox-size": [/^\d+(\.\d+)?px$/],
          "--task-checkbox-offset": [/^\d+(\.\d+)?px$/],
          "--task-checkbox-gap": [/^\d+(\.\d+)?px$/],
          "--task-checkmark-width": [/^\d+(\.\d+)?px$/],
          "--task-checkmark-height": [/^\d+(\.\d+)?px$/],
          "--task-checkmark-left": [/^\d+(\.\d+)?px$/],
          "--task-checkmark-top": [/^\d+(\.\d+)?px$/],
          "--task-checkmark-border": [/^\d+(\.\d+)?px$/],
          "--task-checkbox-radius": [/^\d+(\.\d+)?px$/],
          "--task-check-stroke": [/^\d+(\.\d+)?px$/],
          "--task-check-length": [/^\d+(\.\d+)?$/],
        },
      },
    });
  }

  private isLegacyHtmlPayload(payload: object): payload is { html: string } {
    return "html" in payload && typeof (payload as { html?: unknown }).html === "string";
  }
}
