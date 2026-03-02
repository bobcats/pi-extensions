import * as fs from "node:fs";
import * as path from "node:path";
import { buildVaultIndex } from "./lib.ts";

const CONTENT_DIR = path.join(import.meta.dirname, "content");

export type InitState = "empty" | "v2";

export function getInitState(dir: string): InitState {
  try {
    if (fs.existsSync(path.join(dir, "index.md"))) return "v2";
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
  fs.mkdirSync(path.join(vaultDir, "projects"), { recursive: true });

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
