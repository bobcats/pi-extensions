import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface ServerInfo {
  port: number;
  pid: number;
}

export interface TldrawDoc {
  id: string;
  name: string;
  [key: string]: unknown;
}

const SERVER_JSON_PATHS: Record<string, string> = {
  darwin: "Library/Application Support/tldraw/server.json",
  linux: ".config/tldraw/server.json",
  win32: "AppData/Roaming/tldraw/server.json",
};

function serverJsonPath(): string {
  const relative = SERVER_JSON_PATHS[process.platform];
  if (!relative) throw new Error(`Unsupported platform: ${process.platform}`);
  return path.join(homedir(), relative);
}

export async function readServerInfo(): Promise<ServerInfo> {
  const raw = await readFile(serverJsonPath(), "utf-8");
  const data = JSON.parse(raw);
  if (typeof data.port !== "number") throw new Error("Invalid server.json: missing port");
  return { port: data.port, pid: data.pid };
}

export function createClient(port: number) {
  const base = `http://localhost:${port}`;

  async function request(
    method: string,
    endpoint: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown; text: string }> {
    const url = `${base}${endpoint}`;
    const headers: Record<string, string> = {};
    let bodyStr: string | undefined;

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyStr = JSON.stringify(body);
    }

    const res = await fetch(url, { method, headers, body: bodyStr });
    const text = await res.text();

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!res.ok) {
      throw new Error(`tldraw API ${method} ${endpoint} returned ${res.status}: ${text.slice(0, 500)}`);
    }

    return { status: res.status, data, text };
  }

  return {
    async apiDocs(): Promise<string> {
      const { text } = await request("GET", "/");
      return text;
    },

    async llmDocs(): Promise<string> {
      const { text } = await request("GET", "/api/llms");
      return text;
    },

    async listDocs(name?: string): Promise<TldrawDoc[]> {
      const qs = name ? `?name=${encodeURIComponent(name)}` : "";
      const { data } = await request("GET", `/api/doc${qs}`);
      const result = data as { docs?: TldrawDoc[] } | TldrawDoc[];
      if (Array.isArray(result)) return result;
      if (result && Array.isArray(result.docs)) return result.docs;
      return [];
    },

    async getShapes(docId: string): Promise<unknown> {
      const { data } = await request("GET", `/api/doc/${encodeURIComponent(docId)}/shapes`);
      return data;
    },

    async getScreenshot(
      docId: string,
      options?: { size?: "small" | "medium" | "large" | "full"; bounds?: string },
    ): Promise<Buffer> {
      const params = new URLSearchParams();
      if (options?.size) params.set("size", options.size);
      if (options?.bounds) params.set("bounds", options.bounds);
      const qs = params.toString() ? `?${params}` : "";
      const url = `${base}/api/doc/${encodeURIComponent(docId)}/screenshot${qs}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Screenshot request failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },

    async applyActions(docId: string, actions: unknown[]): Promise<unknown> {
      const { data } = await request("POST", `/api/doc/${encodeURIComponent(docId)}/actions`, {
        actions,
      });
      return data;
    },

    async execCode(docId: string, code: string): Promise<unknown> {
      const { data } = await request("POST", `/api/doc/${encodeURIComponent(docId)}/exec`, {
        code,
      });
      return data;
    },
  };
}

export type TldrawClient = ReturnType<typeof createClient>;
