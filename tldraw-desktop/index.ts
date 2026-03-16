import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { readServerInfo, createClient, type TldrawClient } from "./client.ts";

async function getClient(): Promise<{ client: TldrawClient; port: number }> {
  const info = await readServerInfo();
  return { client: createClient(info.port), port: info.port };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n\n[Truncated at ${max} chars. Full output is ${text.length} chars.]`;
}

export default function tldrawDesktop(pi: ExtensionAPI) {
  pi.registerTool({
    name: "tldraw_server_status",
    label: "tldraw Status",
    description: "Check if the tldraw desktop app is running and reachable.",
    promptSnippet: "Check tldraw desktop app connection status.",
    parameters: Type.Object({}),

    async execute() {
      try {
        const { client, port } = await getClient();
        const docs = await client.listDocs();
        return {
          content: [
            {
              type: "text",
              text: `tldraw desktop is running on port ${port} with ${docs.length} open document(s).`,
            },
          ],
          details: { port, docCount: docs.length },
        };
      } catch (err) {
        throw new Error(
          `tldraw desktop is not reachable. Is the app running? ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });

  pi.registerTool({
    name: "tldraw_list_docs",
    label: "tldraw List Docs",
    description: "List all open documents in tldraw desktop. Optionally filter by name.",
    promptSnippet: "List open tldraw documents.",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Filter documents by name." })),
    }),

    async execute(_toolCallId, params) {
      const { client } = await getClient();
      const docs = await client.listDocs(params.name);
      const summary = docs
        .map((d) => `- ${d.name} (id: ${d.id})`)
        .join("\n");
      return {
        content: [{ type: "text", text: docs.length > 0 ? summary : "No open documents." }],
        details: { docs },
      };
    },
  });

  pi.registerTool({
    name: "tldraw_get_shapes",
    label: "tldraw Get Shapes",
    description:
      "Get all shapes on the current page of a tldraw document. Returns structured shape data.",
    promptSnippet: "Get shapes from a tldraw document.",
    promptGuidelines: [
      "Call tldraw_list_docs first to get the document ID.",
      "Use this to understand what is on the canvas before making changes.",
    ],
    parameters: Type.Object({
      docId: Type.String({ description: "Document ID from tldraw_list_docs." }),
    }),

    async execute(_toolCallId, params) {
      const { client } = await getClient();
      const shapes = await client.getShapes(params.docId);
      const text = JSON.stringify(shapes, null, 2);
      return {
        content: [{ type: "text", text: truncate(text, 40_000) }],
        details: { shapes },
      };
    },
  });

  pi.registerTool({
    name: "tldraw_get_screenshot",
    label: "tldraw Screenshot",
    description:
      "Take a screenshot of a tldraw document canvas. Returns the image as a base64 JPEG.",
    promptSnippet: "Take a screenshot of a tldraw canvas.",
    promptGuidelines: [
      "Use screenshots to understand spatial layout when shape data alone is insufficient.",
    ],
    parameters: Type.Object({
      docId: Type.String({ description: "Document ID from tldraw_list_docs." }),
      size: Type.Optional(
        StringEnum(["small", "medium", "large", "full"] as const, {
          description: "Screenshot resolution. small=768px, medium=1536px, large=3072px, full=5000px.",
        }),
      ),
      bounds: Type.Optional(
        Type.String({ description: "Crop to area: x,y,w,h (e.g. '0,0,500,400')." }),
      ),
    }),

    async execute(_toolCallId, params) {
      const { client } = await getClient();
      const buf = await client.getScreenshot(params.docId, {
        size: params.size,
        bounds: params.bounds,
      });
      const tempPath = path.join(tmpdir(), `tldraw-screenshot-${Date.now()}.jpg`);
      await writeFile(tempPath, buf);
      return {
        content: [
          { type: "text", text: `Screenshot saved to ${tempPath} (${buf.length} bytes). Use the read tool to view it.` },
        ],
        details: { path: tempPath, bytes: buf.length },
      };
    },
  });

  pi.registerTool({
    name: "tldraw_apply_actions",
    label: "tldraw Actions",
    description:
      "Apply structured canvas actions to a tldraw document. Actions: create, update, delete, clear, move, place, label, align, distribute, stack, bringToFront, sendToBack, resize, rotate, pen, setMyView.",
    promptSnippet: "Apply structured actions to a tldraw canvas.",
    promptGuidelines: [
      "Prefer tldraw_apply_actions over tldraw_exec_code for canvas manipulation.",
      "Call tldraw_llms_docs to learn the action format if unsure.",
      "Call tldraw_get_shapes first to understand the current canvas state.",
    ],
    parameters: Type.Object({
      docId: Type.String({ description: "Document ID from tldraw_list_docs." }),
      actions: Type.Array(
        Type.Record(Type.String(), Type.Unknown()),
        { description: "Array of action objects. Each must have a _type field." },
      ),
    }),

    async execute(_toolCallId, params) {
      const { client } = await getClient();
      const result = await client.applyActions(params.docId, params.actions);
      const text = JSON.stringify(result, null, 2);
      return {
        content: [{ type: "text", text: truncate(text, 20_000) }],
        details: { result },
      };
    },
  });

  pi.registerTool({
    name: "tldraw_llms_docs",
    label: "tldraw LLM Docs",
    description:
      "Fetch the tldraw SDK documentation optimized for LLMs. Call this to learn shape formats, action schemas, and editor API details.",
    promptSnippet: "Fetch tldraw SDK reference for LLMs.",
    promptGuidelines: [
      "Call this before creating or updating shapes if you are unsure of the shape format or action schema.",
    ],
    parameters: Type.Object({}),

    async execute() {
      const { client } = await getClient();
      const docs = await client.llmDocs();
      return {
        content: [{ type: "text", text: truncate(docs, 45_000) }],
        details: {},
      };
    },
  });

  pi.registerCommand("tldraw", {
    description: "Check tldraw desktop connection status",
    handler: async (_args, ctx) => {
      try {
        const { client, port } = await getClient();
        const docs = await client.listDocs();
        const docList = docs.map((d) => `  - ${d.name} (${d.id})`).join("\n");
        ctx.ui.notify(
          `tldraw desktop running on port ${port}\n${docs.length} document(s):\n${docList}`,
          "info",
        );
      } catch (err) {
        ctx.ui.notify(
          `tldraw desktop not reachable: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });
}
