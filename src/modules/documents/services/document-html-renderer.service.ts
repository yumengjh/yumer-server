import { Injectable } from "@nestjs/common";
import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import sanitizeHtml from "sanitize-html";
import { tiptapSerializationExtensions } from "./tiptap-serialization.extensions";

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
        content: [block.payload],
      },
    });
  }

  sanitize(html: string): string {
    return sanitizeHtml(html, {
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
        th: ["colspan", "rowspan"],
        td: ["colspan", "rowspan"],
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
        },
      },
    });
  }

  private isLegacyHtmlPayload(payload: object): payload is { html: string } {
    return "html" in payload && typeof (payload as { html?: unknown }).html === "string";
  }
}
