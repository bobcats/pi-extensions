import { homedir } from "node:os";
import { createCollector, recordInvocation, summarizeByHandler, type Collector, type Surface } from "./collector.ts";
import { appendProfileRows, createProfilePath, type AggregateDeltaRow, type ProfileRow } from "./persistence.ts";

type TimerLike = { unref?: () => void };

export type RecordSample = {
  cwd: string;
  extensionPath: string | undefined;
  surface: Surface;
  name: string;
  ms: number;
  ok: boolean;
};

export type RecorderStatus = {
  active: boolean;
  runId?: string;
  outputPath?: string;
  seq: number;
  lastCwd?: string;
  lastWriteError?: string;
  consecutiveWriteFailures: number;
  disabledReason?: string;
};

export type RecorderRuntime = {
  start: () => Promise<RecorderStatus>;
  stop: (reason?: string) => Promise<RecorderStatus>;
  flush: () => Promise<RecorderStatus>;
  record: (sample: RecordSample) => void;
  status: () => RecorderStatus;
};

export type RecorderRuntimeDeps = {
  homeDir?: string;
  now?: () => string;
  randomId?: () => string;
  appendRows?: (outputPath: string, rows: ProfileRow[]) => Promise<void>;
  setInterval?: (callback: () => void, ms: number) => TimerLike;
  clearInterval?: (timer: TimerLike) => void;
  flushIntervalMs?: number;
  maxHandlers?: number;
};

type ActiveRun = {
  runId: string;
  outputPath: string;
  startedAt: string;
  windowStart: string;
  totalCollector: Collector;
  deltaCollector: Collector;
  timer?: TimerLike;
  seq: number;
};

const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
const GLOBAL_RUNTIME_KEY = Symbol.for("ext-prof.v2.runtime");

type GlobalRecorder = typeof globalThis & {
  [GLOBAL_RUNTIME_KEY]?: RecorderRuntime;
};

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultRandomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createEmptyCollector(maxHandlers: number): Collector {
  return createCollector({ maxHandlers });
}

export function createRecorderRuntime(deps: RecorderRuntimeDeps = {}): RecorderRuntime {
  const homeDir = deps.homeDir ?? homedir();
  const now = deps.now ?? defaultNow;
  const randomId = deps.randomId ?? defaultRandomId;
  const appendRows = deps.appendRows ?? appendProfileRows;
  const startTimer = deps.setInterval ?? ((callback, ms) => setInterval(callback, ms));
  const clearTimer = deps.clearInterval ?? ((timer) => clearInterval(timer as NodeJS.Timeout));
  const flushIntervalMs = deps.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const maxHandlers = deps.maxHandlers ?? 10_000;

  let active: ActiveRun | undefined;
  let writeQueue: Promise<void> = Promise.resolve();
  let lastWriteError: string | undefined;
  let consecutiveWriteFailures = 0;
  let disabledReason: string | undefined;
  let lastCwd: string | undefined;

  const status = (): RecorderStatus => ({
    active: Boolean(active),
    runId: active?.runId,
    outputPath: active?.outputPath,
    seq: active?.seq ?? 0,
    lastCwd,
    lastWriteError,
    consecutiveWriteFailures,
    disabledReason,
  });

  const clearActiveTimer = () => {
    if (active?.timer) {
      clearTimer(active.timer);
      active.timer = undefined;
    }
  };

  const writeRecordingEndBestEffort = async (run: ActiveRun, reason: string): Promise<void> => {
    try {
      await appendRows(run.outputPath, [
        { schemaVersion: 2, type: "recording_end", runId: run.runId, endedAt: now(), reason },
      ]);
    } catch {
      // Ignore: write-failure auto-disable must never throw back into handler or flush paths.
    }
  };

  const autoDisableAfterWriteFailures = async (): Promise<void> => {
    if (!active || consecutiveWriteFailures < 3) return;
    const run = active;
    clearActiveTimer();
    active = undefined;
    disabledReason = "write_failures";
    await writeRecordingEndBestEffort(run, "write_failures");
  };

  const enqueueWrite = (outputPath: string, rows: ProfileRow[]): Promise<void> => {
    const write = async () => {
      try {
        await appendRows(outputPath, rows);
        consecutiveWriteFailures = 0;
        lastWriteError = undefined;
      } catch (error) {
        consecutiveWriteFailures += 1;
        lastWriteError = errorMessage(error);
        await autoDisableAfterWriteFailures();
      }
    };

    const queued = writeQueue.then(write, write);
    writeQueue = queued.catch(() => {});
    return queued;
  };

  const flush = async (): Promise<RecorderStatus> => {
    const run = active;
    if (!run) {
      await writeQueue;
      return status();
    }

    const handlers = summarizeByHandler(run.deltaCollector);
    if (handlers.length === 0) {
      await writeQueue;
      return status();
    }

    run.deltaCollector = createEmptyCollector(maxHandlers);
    const seq = run.seq + 1;
    run.seq = seq;
    const windowStart = run.windowStart;
    const windowEnd = now();
    run.windowStart = windowEnd;

    const rows: AggregateDeltaRow[] = handlers.map((handler) => ({
      schemaVersion: 2,
      type: "aggregate_delta",
      runId: run.runId,
      seq,
      windowStart,
      windowEnd,
      cwd: handler.cwd,
      extensionPath: handler.extensionPath,
      surface: handler.surface,
      name: handler.name,
      calls: handler.calls,
      totalMs: handler.totalMs,
      maxMs: handler.maxMs,
      errorCount: handler.errorCount,
    }));

    await enqueueWrite(run.outputPath, rows);
    return status();
  };

  const runtime: RecorderRuntime = {
    async start(): Promise<RecorderStatus> {
      if (active) return status();

      const startedAt = now();
      const runId = randomId();
      const outputPath = createProfilePath({ homeDir, startedAt, runId });

      try {
        await appendRows(outputPath, [{ schemaVersion: 2, type: "recording_start", runId, startedAt }]);
      } catch (error) {
        consecutiveWriteFailures = 1;
        lastWriteError = errorMessage(error);
        disabledReason = "start_failed";
        return status();
      }

      consecutiveWriteFailures = 0;
      lastWriteError = undefined;
      disabledReason = undefined;
      active = {
        runId,
        outputPath,
        startedAt,
        windowStart: startedAt,
        totalCollector: createEmptyCollector(maxHandlers),
        deltaCollector: createEmptyCollector(maxHandlers),
        seq: 0,
      };
      const timer = startTimer(() => {
        void runtime.flush();
      }, flushIntervalMs);
      timer.unref?.();
      active.timer = timer;

      return status();
    },

    async stop(reason = "off"): Promise<RecorderStatus> {
      if (!active) {
        await writeQueue;
        return status();
      }

      clearActiveTimer();
      await runtime.flush();
      const run = active;
      if (!run) return status();
      active = undefined;
      disabledReason = reason;
      await enqueueWrite(run.outputPath, [
        { schemaVersion: 2, type: "recording_end", runId: run.runId, endedAt: now(), reason },
      ]);
      await writeQueue;
      return status();
    },

    flush,

    record(sample: RecordSample): void {
      if (!active) return;
      lastCwd = sample.cwd;
      recordInvocation(active.totalCollector, sample);
      recordInvocation(active.deltaCollector, sample);
    },

    status,
  };

  return runtime;
}

export function getGlobalRecorderRuntime(deps: RecorderRuntimeDeps = {}): RecorderRuntime {
  const g = globalThis as GlobalRecorder;
  if (!g[GLOBAL_RUNTIME_KEY]) {
    g[GLOBAL_RUNTIME_KEY] = createRecorderRuntime(deps);
  }
  return g[GLOBAL_RUNTIME_KEY];
}

export function resetGlobalRecorderRuntimeForTests(): void {
  const g = globalThis as GlobalRecorder;
  delete g[GLOBAL_RUNTIME_KEY];
}
