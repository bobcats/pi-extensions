import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function isTmuxAvailable(): boolean {
	return !!process.env.TMUX;
}

export function shellEscape(s: string): string {
	return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function getParentPane(): string | undefined {
	return process.env.TMUX_PANE || undefined;
}

function tmuxOutput(args: string[]): string {
	return execFileSync("tmux", args, { encoding: "utf8" }).trim();
}

function tryTmuxOutput(args: string[]): string | undefined {
	try {
		return tmuxOutput(args);
	} catch {
		return undefined;
	}
}

function runTmuxBestEffort(args: string[]): void {
	tryTmuxOutput(args);
}

function configurePane(pane: string, name: string): void {
	runTmuxBestEffort(["set-option", "-t", pane, "remain-on-exit", "on"]);
	runTmuxBestEffort(["select-pane", "-t", pane, "-T", name]);
}

export function getParentSession(): string | undefined {
	const parentPane = getParentPane();
	if (!parentPane) return undefined;
	return tryTmuxOutput(["display-message", "-p", "-t", parentPane, "#{session_id}"]);
}

export function getSourceWindowToken(): string {
	const parentPane = getParentPane();
	if (!parentPane) return "unknown";
	return tryTmuxOutput(["display-message", "-p", "-t", parentPane, "#{window_index}"]) ?? "unknown";
}

export function makeBatchWindowName(batchId: string): string {
	return `subagents-${getSourceWindowToken()}-${batchId}`;
}

export function createWindow(name: string): string {
	const parentSession = getParentSession();
	const args = ["new-window", "-d", "-P", "-F", "#{window_id}", "-n", name];
	if (parentSession) args.push("-t", parentSession);
	return tmuxOutput(args);
}

export function createPaneWithCommand(name: string, command: string): string {
	const parentPane = getParentPane();
	const args = ["split-window", "-h", "-d", "-P", "-F", "#{pane_id}"];
	if (parentPane) args.push("-t", parentPane);
	args.push("bash", "-c", command);

	const pane = tmuxOutput(args);
	configurePane(pane, name);
	return pane;
}

export function getWindowPanes(windowId: string): string[] {
	const output = tryTmuxOutput(["list-panes", "-t", windowId, "-F", "#{pane_id}"]);
	return output
		? output
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
		: [];
}

export function runCommandInPane(pane: string, name: string, command: string): void {
	execFileSync("tmux", ["respawn-pane", "-k", "-t", pane, "bash", "-c", command]);
	configurePane(pane, name);
}

export function createPaneInWindow(windowId: string, name: string, command: string): string {
	const pane = tmuxOutput(["split-window", "-t", windowId, "-d", "-P", "-F", "#{pane_id}", "bash", "-c", command]);
	configurePane(pane, name);
	return pane;
}

export function tileWindow(windowId: string): void {
	runTmuxBestEffort(["select-layout", "-t", windowId, "tiled"]);
}

export function closeWindow(windowId: string): void {
	runTmuxBestEffort(["kill-window", "-t", windowId]);
}

export function closePane(pane: string): void {
	runTmuxBestEffort(["kill-pane", "-t", pane]);
}

export async function readScreen(pane: string, lines = 5): Promise<string> {
	const { stdout } = await execFileAsync(
		"tmux",
		["capture-pane", "-p", "-t", pane, "-S", `-${Math.max(1, lines)}`],
		{ encoding: "utf8" },
	);
	return stdout;
}
