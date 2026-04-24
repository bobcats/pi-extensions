import { Effect, Fiber } from "effect";
import type { AsyncRun } from "./types.ts";

export interface AsyncOwnerDeps {
	runWatcher: (run: AsyncRun) => Effect.Effect<void, unknown>;
}

export interface AsyncOwner {
	start(run: AsyncRun): void;
	shutdown(): Promise<void>;
	runIds(): string[];
	drainForTests(): Promise<void>;
}

export function createAsyncOwner(deps: AsyncOwnerDeps): AsyncOwner {
	const fibers = new Map<string, Fiber.RuntimeFiber<void, unknown>>();

	function start(run: AsyncRun): void {
		const fiber = Effect.runFork(deps.runWatcher(run));
		fibers.set(run.id, fiber);

		Effect.runFork(
			Fiber.await(fiber).pipe(
				Effect.ignore,
				Effect.andThen(
					Effect.sync(() => {
						fibers.delete(run.id);
					}),
				),
			),
		);
	}

	async function shutdown(): Promise<void> {
		const current = Array.from(fibers.entries());
		await Promise.all(
			current.map(async ([id, fiber]) => {
				await Effect.runPromise(Fiber.interrupt(fiber));
				fibers.delete(id);
			}),
		);
	}

	async function drainForTests(): Promise<void> {
		const current = Array.from(fibers.values());
		await Promise.all(current.map((fiber) => Effect.runPromise(Fiber.join(fiber))));
	}

	return {
		start,
		shutdown,
		runIds: () => Array.from(fibers.keys()),
		drainForTests,
	};
}
