import test from "node:test";
import assert from "node:assert/strict";
import { ProgressWidget } from "./widget.ts";

test("ProgressWidget.setStep updates lines and calls setWidget", () => {
  const widgetCalls: { key: string; lines: string[] | undefined }[] = [];
  const ui = {
    setWidget(key: string, lines: string[] | undefined) {
      widgetCalls.push({ key, lines: lines ? [...lines] : undefined });
    },
  };

  const widget = new ProgressWidget(ui as any, "test-op");
  widget.setStep("auditor", "running");
  
  assert.equal(widgetCalls.length, 1);
  assert.equal(widgetCalls[0].key, "test-op");
  assert.ok(widgetCalls[0].lines!.some((l: string) => l.includes("auditor") && l.includes("⏳")));
  widget.clear();
});

test("ProgressWidget.setStep tracks multiple agents", () => {
  const lastLines: string[][] = [];
  const ui = {
    setWidget(_key: string, lines: string[] | undefined) {
      if (lines) lastLines.push([...lines]);
    },
  };

  const widget = new ProgressWidget(ui as any, "test-op");
  widget.setStep("miner 1", "running");
  widget.setStep("miner 2", "running");
  widget.setStep("miner 1", "done", "5 findings");

  const last = lastLines[lastLines.length - 1];
  assert.ok(last.some((l: string) => l.includes("miner 1") && l.includes("5 findings")));
  assert.ok(last.some((l: string) => l.includes("miner 2") && l.includes("⏳")));
  widget.clear();
});

test("ProgressWidget.clear calls setWidget with undefined", () => {
  const widgetCalls: { key: string; lines: string[] | undefined }[] = [];
  const ui = {
    setWidget(key: string, lines: string[] | undefined) {
      widgetCalls.push({ key, lines });
    },
  };

  const widget = new ProgressWidget(ui as any, "test-op");
  widget.setStep("auditor", "running");
  widget.clear();

  const last = widgetCalls[widgetCalls.length - 1];
  assert.equal(last.key, "test-op");
  assert.equal(last.lines, undefined);
});

test("ProgressWidget.setHeader shows header line above steps", () => {
  let lastLines: string[] = [];
  const ui = {
    setWidget(_key: string, lines: string[] | undefined) {
      if (lines) lastLines = [...lines];
    },
  };

  const widget = new ProgressWidget(ui as any, "test-op");
  widget.setHeader("Found 47 conversations in 3 batches");
  widget.setStep("miner 1", "running");

  assert.ok(lastLines[0].includes("47 conversations"));
  assert.ok(lastLines.length >= 2);
  widget.clear();
});

test("ProgressWidget running steps show elapsed time", () => {
  let lastLines: string[] = [];
  const ui = {
    setWidget(_key: string, lines: string[] | undefined) {
      if (lines) lastLines = [...lines];
    },
  };

  const widget = new ProgressWidget(ui as any, "test-op");
  widget.setStep("auditor", "running");

  // Initial render should show elapsed time (0s)
  assert.ok(lastLines.some((l: string) => l.includes("0s")));
  widget.clear();
});

test("ProgressWidget stops timer when no steps are running", () => {
  const ui = { setWidget() {} };

  const widget = new ProgressWidget(ui as any, "test-op");
  widget.setStep("auditor", "running");
  widget.setStep("auditor", "done");

  // No assertion needed — if timer leaks, test runner would hang.
  // The fact that this test completes proves the timer stopped.
});

test("ProgressWidget error step shows detail instead of elapsed time", () => {
  let lastLines: string[] = [];
  const ui = {
    setWidget(_key: string, lines: string[] | undefined) {
      if (lines) lastLines = [...lines];
    },
  };

  const widget = new ProgressWidget(ui as any, "test-op");
  widget.setStep("auditor", "error", "timed out");

  assert.ok(lastLines.some((l: string) => l.includes("✗") && l.includes("timed out")));
  assert.ok(lastLines.every((l: string) => !l.includes("0s")));
});
