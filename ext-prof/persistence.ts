import path from "node:path";
import { mkdir, rename, writeFile } from "node:fs/promises";

export async function saveSnapshot(args: {
  outputPath: string;
  sessionMeta: Record<string, unknown> & { schemaVersion: 1 };
  aggregates: Array<Record<string, unknown>>;
}): Promise<void> {
  await mkdir(path.dirname(args.outputPath), { recursive: true });

  const tmp = `${args.outputPath}.tmp-${process.pid}`;
  const lines = [
    JSON.stringify({ type: "session_meta", ...args.sessionMeta }),
    ...args.aggregates.map((row) => JSON.stringify({ type: "aggregate", ...row })),
  ];

  await writeFile(tmp, `${lines.join("\n")}\n`, "utf8");
  await rename(tmp, args.outputPath);
}
