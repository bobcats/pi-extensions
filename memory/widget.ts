import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";

type StepStatus = "running" | "done" | "error";

interface StepState {
  name: string;
  status: StepStatus;
  detail?: string;
  startedAt?: number;
}

const STATUS_ICONS: Record<StepStatus, string> = {
  running: "⏳",
  done: "✓",
  error: "✗",
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

export class ProgressWidget {
  private steps: StepState[] = [];
  private header: string | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

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
      if (status === "running") {
        existing.startedAt = Date.now();
      }
    } else {
      this.steps.push({ name, status, detail, startedAt: status === "running" ? Date.now() : undefined });
    }

    if (status === "running") {
      this.ensureTimer();
    } else if (!this.steps.some((s) => s.status === "running")) {
      this.stopTimer();
    }

    this.render();
  }

  clear(): void {
    this.stopTimer();
    this.steps = [];
    this.header = undefined;
    this.ui.setWidget(this.key, undefined);
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.render(), 1000);
    this.timer.unref();
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private render(): void {
    const lines: string[] = [];
    if (this.header) lines.push(this.header);
    const now = Date.now();
    for (const step of this.steps) {
      const icon = STATUS_ICONS[step.status];
      let suffix = step.detail ? `: ${step.detail}` : "";
      if (step.status === "running" && step.startedAt) {
        const elapsed = formatElapsed(now - step.startedAt);
        suffix = ` (${elapsed})`;
      }
      lines.push(`${icon} ${step.name}${suffix}`);
    }
    this.ui.setWidget(this.key, lines);
  }
}
