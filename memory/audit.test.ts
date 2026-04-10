import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memory-audit-test-"));
}

test("brain-audit treats raw files as read-only inputs, not orphan cleanup targets", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "raw"), { recursive: true });

  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n\n- [[note]]\n");
  fs.writeFileSync(path.join(dir, "note.md"), "# Note\n");
  fs.writeFileSync(path.join(dir, "raw", "source.md"), Array.from({ length: 20 }, () => "line").join("\n"));

  const output = execFileSync("bash", [path.join(import.meta.dirname, "scripts", "brain-audit.sh"), dir], {
    encoding: "utf-8",
  });

  assert.match(output, /=== Raw Sources \(read-only\) ===/);
  assert.match(output, /raw\/source\.md/);
  assert.doesNotMatch(output, /ORPHAN: \.\/raw\/source\.md/);
});
