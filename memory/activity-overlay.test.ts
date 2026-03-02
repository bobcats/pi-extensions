import test from "node:test";
import assert from "node:assert/strict";
import { ActivityOverlay } from "./activity-overlay.ts";

test("ActivityOverlay.render shows agent label and text lines", () => {
  const overlay = new ActivityOverlay();
  overlay.setAgent("Auditor");
  overlay.appendText("Analyzing vault structure...\n");
  overlay.appendText("Found 12 files.\n");

  const lines = overlay.render(40);
  assert.ok(lines.length > 0);
  assert.ok(lines.some((l: string) => l.includes("Auditor")));
  const content = lines.join("\n");
  assert.ok(content.includes("Analyzing"));
  assert.ok(content.includes("12 files"));
});

test("ActivityOverlay.render tail-scrolls when text exceeds height", () => {
  const overlay = new ActivityOverlay(5);
  overlay.setAgent("Miner");
  for (let i = 0; i < 20; i++) {
    overlay.appendText(`Line ${i}\n`);
  }

  const lines = overlay.render(40);
  const content = lines.join("\n");
  assert.ok(content.includes("Line 19"));
  assert.ok(!content.includes("Line 0"));
});

test("ActivityOverlay.clear resets state", () => {
  const overlay = new ActivityOverlay();
  overlay.setAgent("Auditor");
  overlay.appendText("hello\n");
  overlay.clear();

  const lines = overlay.render(40);
  const content = lines.join("\n");
  assert.ok(!content.includes("hello"));
});

test("ActivityOverlay.setLabel changes header without clearing text", () => {
  const overlay = new ActivityOverlay();
  overlay.setAgent("Miner 1");
  overlay.appendText("finding A\n");
  overlay.setLabel("Miner 2");
  overlay.appendText("finding B\n");

  const lines = overlay.render(40);
  const content = lines.join("\n");
  assert.ok(content.includes("Miner 2"), "header should show new label");
  assert.ok(content.includes("finding A"), "text from before setLabel should be preserved");
  assert.ok(content.includes("finding B"), "text from after setLabel should be present");
});

test("ActivityOverlay.setLabel no-ops when name is unchanged", () => {
  const overlay = new ActivityOverlay();
  overlay.setAgent("Miner 1");
  overlay.appendText("hello\n");
  const lines1 = overlay.render(40);
  overlay.setLabel("Miner 1"); // same name — should not invalidate
  const lines2 = overlay.render(40);
  assert.equal(lines1, lines2, "cached render should be reused when label unchanged");
});

test("ActivityOverlay.invalidate clears cached render", () => {
  const overlay = new ActivityOverlay();
  overlay.setAgent("Test");
  const lines1 = overlay.render(40);
  overlay.appendText("new text\n");
  overlay.invalidate();
  const lines2 = overlay.render(40);
  assert.notDeepEqual(lines1, lines2);
});
