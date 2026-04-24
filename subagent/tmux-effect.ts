import { Effect } from "effect";
import {
	closePane,
	closeWindow,
	createPaneInWindow,
	createPaneWithCommand,
	createWindow,
	getWindowPanes,
	isTmuxAvailable,
	makeBatchWindowName,
	readScreen,
	runCommandInPane,
	shellEscape,
	tileWindow,
} from "./tmux.ts";
import { TmuxCommandFailed, TmuxUnavailable } from "./errors.ts";

export interface TmuxOps {
	isAvailable(): boolean;
	createPaneWithCommand(name: string, command: string): string;
	createWindow(name: string): string;
	getWindowPanes(windowId: string): string[];
	runCommandInPane(pane: string, name: string, command: string): void;
	createPaneInWindow(windowId: string, name: string, command: string): string;
	tileWindow(windowId: string): void;
	closePane(pane: string): void;
	closeWindow(windowId: string): void;
	readScreen(pane: string, lines?: number): Promise<string>;
	makeBatchWindowName(batchId: string): string;
	shellEscape(value: string): string;
}

export const liveTmuxOps: TmuxOps = {
	isAvailable: isTmuxAvailable,
	createPaneWithCommand,
	createWindow,
	getWindowPanes,
	runCommandInPane,
	createPaneInWindow,
	tileWindow,
	closePane,
	closeWindow,
	readScreen,
	makeBatchWindowName,
	shellEscape,
};

export function requireTmux(ops: TmuxOps = liveTmuxOps): Effect.Effect<void, TmuxUnavailable> {
	return ops.isAvailable()
		? Effect.void
		: Effect.fail(new TmuxUnavailable({ message: "async: true requires tmux. Start pi inside a tmux session." }));
}

export function adoptPane(pane: string, ops: TmuxOps = liveTmuxOps): Effect.Effect<string> {
	return Effect.acquireRelease(Effect.succeed(pane), (ownedPane) => Effect.sync(() => ops.closePane(ownedPane)));
}

export function adoptWindow(windowId: string, ops: TmuxOps = liveTmuxOps): Effect.Effect<string> {
	return Effect.acquireRelease(
		Effect.succeed(windowId),
		(ownedWindow) => Effect.sync(() => ops.closeWindow(ownedWindow)),
	);
}

export function pollForExitEffect(
	pane: string,
	options: { ops?: TmuxOps; intervalMs?: number; onTick?: () => void },
): Effect.Effect<number, TmuxCommandFailed> {
	const ops = options.ops ?? liveTmuxOps;
	const intervalMs = options.intervalMs ?? 1000;

	return Effect.gen(function* loop() {
		const screen = yield* Effect.tryPromise({
			try: () => ops.readScreen(pane, 5),
			catch: (cause) => new TmuxCommandFailed({ command: "capture-pane", cause }),
		});
		const match = screen.match(/__SUBAGENT_DONE_(\d+)__/);
		if (match) return parseInt(match[1], 10);
		options.onTick?.();
		yield* Effect.sleep(`${intervalMs} millis`);
		return yield* loop();
	});
}
