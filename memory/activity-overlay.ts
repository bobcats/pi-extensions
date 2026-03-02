import { truncateToWidth, wrapTextWithAnsi, visibleWidth } from "@mariozechner/pi-tui";

const DEFAULT_MAX_LINES = 30;

export class ActivityOverlay {
  private agent = "";
  private textLines: string[] = [];
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(private maxLines: number = DEFAULT_MAX_LINES) {}

  setAgent(name: string): void {
    this.agent = name;
    this.textLines = [];
    this.invalidate();
  }

  setLabel(name: string): void {
    if (this.agent !== name) {
      this.agent = name;
      this.invalidate();
    }
  }

  appendText(text: string): void {
    const newLines = text.split("\n");
    if (this.textLines.length > 0 && newLines.length > 0) {
      this.textLines[this.textLines.length - 1] += newLines.shift()!;
    } else if (newLines.length > 0) {
      this.textLines.push(newLines.shift()!);
    }
    this.textLines.push(...newLines);
    this.invalidate();
  }

  clear(): void {
    this.agent = "";
    this.textLines = [];
    this.invalidate();
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const innerWidth = Math.max(width - 4, 10); // 2 border + 2 padding
    const lines: string[] = [];

    // Top border
    const header = this.agent ? ` ${this.agent} ` : "";
    const topFill = Math.max(0, width - 2 - header.length);
    lines.push(`╭${header}${"─".repeat(topFill)}╮`);

    // Content: tail-scroll to maxLines
    const visible = this.textLines.slice(-this.maxLines);
    if (visible.length === 0) {
      lines.push(this.padRow("(waiting...)", width, innerWidth));
    } else {
      for (const textLine of visible) {
        const wrapped = wrapTextWithAnsi(textLine || " ", innerWidth);
        for (const wl of wrapped) {
          lines.push(this.padRow(wl, width, innerWidth));
        }
      }
    }

    // Bottom border
    lines.push(`╰${"─".repeat(width - 2)}╯`);

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  private padRow(content: string, totalWidth: number, innerWidth: number): string {
    const truncated = truncateToWidth(content, innerWidth);
    const vis = visibleWidth(truncated);
    const pad = Math.max(0, innerWidth - vis);
    return `│ ${truncated}${" ".repeat(pad)} │`;
  }

  handleInput(_data: string): void {
    // No-op — passive overlay
  }
}
