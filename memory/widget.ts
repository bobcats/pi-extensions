import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";

type StepStatus = "running" | "done" | "error";

interface StepState {
  name: string;
  status: StepStatus;
  detail?: string;
}

const STATUS_ICONS: Record<StepStatus, string> = {
  running: "⏳",
  done: "✓",
  error: "✗",
};

export class ProgressWidget {
  private steps: StepState[] = [];
  private header: string | undefined;

  constructor(
    private ui: Pick<ExtensionUIContext, "setWidget">,
    private key: string,
  ) {}

  setHeader(text: string): void {
    this.header = text;
    this.render();
  }

  setStep(name: string, status: StepStatus, detail?: string): void {
    const existing = this.steps.find((s) => s.name === name);
    if (existing) {
      existing.status = status;
      existing.detail = detail;
    } else {
      this.steps.push({ name, status, detail });
    }
    this.render();
  }

  clear(): void {
    this.steps = [];
    this.header = undefined;
    this.ui.setWidget(this.key, undefined);
  }

  private render(): void {
    const lines: string[] = [];
    if (this.header) lines.push(this.header);
    for (const step of this.steps) {
      const icon = STATUS_ICONS[step.status];
      const detail = step.detail ? `: ${step.detail}` : "";
      lines.push(`${icon} ${step.name}${detail}`);
    }
    this.ui.setWidget(this.key, lines);
  }
}
