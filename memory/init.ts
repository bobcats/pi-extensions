import * as fs from "node:fs";
import * as path from "node:path";
import { buildVaultIndex } from "./lib.ts";

const CONTENT_DIR = path.join(import.meta.dirname, "content");

export type InitState = "empty" | "v1" | "v2";

export function getInitState(dir: string): InitState {
  try {
    if (fs.existsSync(path.join(dir, "index.md"))) return "v2";
    if (fs.existsSync(path.join(dir, "MEMORY.md"))) return "v1";
    const entries = fs.readdirSync(dir);
    if (entries.length === 0) return "empty";
    return "empty";
  } catch {
    return "empty";
  }
}

export interface InitResult {
  created: boolean;
  principlesInstalled: number;
}

export function initVault(vaultDir: string, includePrinciples: boolean): InitResult {
  fs.mkdirSync(vaultDir, { recursive: true });

  let principlesInstalled = 0;

  if (includePrinciples) {
    const srcPrinciples = path.join(CONTENT_DIR, "principles");
    const destPrinciples = path.join(vaultDir, "principles");
    fs.mkdirSync(destPrinciples, { recursive: true });

    const files = fs.readdirSync(srcPrinciples).filter(f => f.endsWith(".md"));
    for (const file of files) {
      const dest = path.join(destPrinciples, file);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(path.join(srcPrinciples, file), dest);
        principlesInstalled++;
      }
    }

    const subIndexSrc = path.join(CONTENT_DIR, "principles.md");
    const subIndexDest = path.join(vaultDir, "principles.md");
    if (fs.existsSync(subIndexSrc) && !fs.existsSync(subIndexDest)) {
      fs.copyFileSync(subIndexSrc, subIndexDest);
    }
  }

  const index = buildVaultIndex(vaultDir);
  fs.writeFileSync(path.join(vaultDir, "index.md"), index);

  return { created: true, principlesInstalled };
}

export function migrateV1Vault(
  dir: string,
  includePrinciples: boolean,
  mode: "preserve" | "replace",
): InitResult {
  if (mode === "preserve") {
    const memoryPath = path.join(dir, "MEMORY.md");
    const migratedPath = path.join(dir, "migrated.md");
    if (fs.existsSync(memoryPath)) {
      fs.renameSync(memoryPath, migratedPath);
    }
  } else {
    const memoryPath = path.join(dir, "MEMORY.md");
    if (fs.existsSync(memoryPath)) {
      fs.unlinkSync(memoryPath);
    }
  }

  return initVault(dir, includePrinciples);
}
