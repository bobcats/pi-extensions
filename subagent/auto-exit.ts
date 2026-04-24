/**
 * Auto-exit extension loaded into async subagent panes.
 * Shuts down the pi session when the agent finishes its turn,
 * so the tmux pane closes and the sentinel fires.
 *
 * If the user sends any input, auto-exit is permanently disabled —
 * the user has taken over the session.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type InputEvent = { source?: unknown };
type ShutdownContext = { shutdown(): void };

export default function (pi: ExtensionAPI) {
	let userTookOver = false;

	pi.on("input", (event: InputEvent | null | undefined) => {
		if (event?.source === "user") {
			userTookOver = true;
		}
	});

	pi.on("agent_end", (_event: unknown, ctx: ShutdownContext) => {
		if (!userTookOver) {
			ctx.shutdown();
		}
	});
}
