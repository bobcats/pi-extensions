import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createClient } from "./client.ts";

function startFakeServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });
}

describe("createClient", () => {
  let port: number;
  let close: () => Promise<void>;
  let lastReq: { method: string; url: string; body: string };

  const routes: Record<string, { status: number; body: unknown; contentType?: string }> = {};

  beforeEach(() => {
    Object.keys(routes).forEach((k) => delete routes[k]);
    lastReq = { method: "", url: "", body: "" };
  });

  after(async () => {
    if (close) await close();
  });

  it("setup fake server", async () => {
    const server = await startFakeServer(async (req, res) => {
      const body = await readBody(req);
      lastReq = { method: req.method ?? "", url: req.url ?? "", body };

      const route = routes[`${req.method} ${req.url?.split("?")[0]}`];
      if (route) {
        const ct = route.contentType ?? "application/json";
        res.writeHead(route.status, { "Content-Type": ct });
        res.end(typeof route.body === "string" ? route.body : JSON.stringify(route.body));
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    });
    port = server.port;
    close = server.close;
  });

  it("listDocs returns parsed array from wrapped response", async () => {
    const docs = [{ id: "abc", name: "My Doc" }];
    routes["GET /api/doc"] = { status: 200, body: { docs } };
    const client = createClient(port);

    const result = await client.listDocs();

    assert.deepEqual(result, docs);
  });

  it("listDocs handles bare array response", async () => {
    const docs = [{ id: "abc", name: "My Doc" }];
    routes["GET /api/doc"] = { status: 200, body: docs };
    const client = createClient(port);

    const result = await client.listDocs();

    assert.deepEqual(result, docs);
  });

  it("listDocs with name filter sends query param", async () => {
    routes["GET /api/doc"] = { status: 200, body: { docs: [] } };
    const client = createClient(port);

    await client.listDocs("test");

    assert.ok(lastReq.url?.includes("?name=test"));
  });

  it("getShapes returns shape data", async () => {
    const shapes = [{ id: "shape:1", type: "geo" }];
    routes["GET /api/doc/doc1/shapes"] = { status: 200, body: shapes };
    const client = createClient(port);

    const result = await client.getShapes("doc1");

    assert.deepEqual(result, shapes);
  });

  it("applyActions sends POST with actions body", async () => {
    routes["POST /api/doc/doc1/actions"] = { status: 200, body: { ok: true } };
    const client = createClient(port);

    const actions = [{ _type: "create", shapeType: "geo", x: 0, y: 0 }];
    await client.applyActions("doc1", actions);

    assert.equal(lastReq.method, "POST");
    const parsed = JSON.parse(lastReq.body);
    assert.deepEqual(parsed.actions, actions);
  });

  it("apiDocs returns text", async () => {
    routes["GET /"] = { status: 200, body: "tldraw Canvas API", contentType: "text/plain" };
    const client = createClient(port);

    const result = await client.apiDocs();

    assert.ok(result.includes("tldraw"));
  });

  it("llmDocs returns text", async () => {
    routes["GET /api/llms"] = { status: 200, body: "# tldraw SDK", contentType: "text/plain" };
    const client = createClient(port);

    const result = await client.llmDocs();

    assert.ok(result.includes("tldraw SDK"));
  });

  it("getScreenshot returns buffer", async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    routes["GET /api/doc/doc1/screenshot"] = {
      status: 200,
      body: fakeJpeg.toString("binary"),
      contentType: "image/jpeg",
    };
    const client = createClient(port);

    const result = await client.getScreenshot("doc1", { size: "small" });

    assert.ok(Buffer.isBuffer(result));
  });

  it("throws on non-ok response", async () => {
    routes["GET /api/doc"] = { status: 500, body: { error: "internal" } };
    const client = createClient(port);

    await assert.rejects(() => client.listDocs(), /returned 500/);
  });

  it("execCode sends POST with code body", async () => {
    routes["POST /api/doc/doc1/exec"] = { status: 200, body: { result: 42 } };
    const client = createClient(port);

    const result = await client.execCode("doc1", "return 42");

    assert.deepEqual(result, { result: 42 });
    assert.equal(lastReq.method, "POST");
    const parsed = JSON.parse(lastReq.body);
    assert.equal(parsed.code, "return 42");
  });
});
