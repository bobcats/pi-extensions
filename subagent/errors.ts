import { Data } from "effect";

export class InvalidSubagentRequest extends Data.TaggedError("InvalidSubagentRequest")<{
	readonly message: string;
}> {}

export class UnknownAgent extends Data.TaggedError("UnknownAgent")<{
	readonly agent: string;
	readonly task: string;
}> {}

export class InvalidModelOverride extends Data.TaggedError("InvalidModelOverride")<{
	readonly message: string;
}> {}

export class ProjectAgentRejected extends Data.TaggedError("ProjectAgentRejected")<{
	readonly mode: "single" | "parallel" | "chain";
}> {}

export class TmuxUnavailable extends Data.TaggedError("TmuxUnavailable")<{
	readonly message: string;
}> {}

export class TmuxCommandFailed extends Data.TaggedError("TmuxCommandFailed")<{
	readonly command: string;
	readonly cause: unknown;
}> {}

export class ChildProcessFailed extends Data.TaggedError("ChildProcessFailed")<{
	readonly message: string;
	readonly exitCode?: number;
}> {}

export class ChildProcessAborted extends Data.TaggedError("ChildProcessAborted")<{
	readonly message: string;
}> {}

export class ProcessOutputParseFailed extends Data.TaggedError("ProcessOutputParseFailed")<{
	readonly line: string;
	readonly cause: unknown;
}> {}

export class TempResourceFailed extends Data.TaggedError("TempResourceFailed")<{
	readonly operation: string;
	readonly cause: unknown;
}> {}

export type SubagentError =
	| InvalidSubagentRequest
	| UnknownAgent
	| InvalidModelOverride
	| ProjectAgentRejected
	| TmuxUnavailable
	| TmuxCommandFailed
	| ChildProcessFailed
	| ChildProcessAborted
	| ProcessOutputParseFailed
	| TempResourceFailed;

export function errorToMessage(error: SubagentError): string {
	switch (error._tag) {
		case "InvalidSubagentRequest":
		case "InvalidModelOverride":
		case "TmuxUnavailable":
		case "ChildProcessFailed":
		case "ChildProcessAborted":
			return error.message;
		case "UnknownAgent":
			return `Unknown agent: "${error.agent}"`;
		case "ProjectAgentRejected":
			return "Canceled: project-local agents not approved.";
		case "TmuxCommandFailed":
			return `tmux command failed: ${error.command}`;
		case "ProcessOutputParseFailed":
			return `Failed to parse child process output: ${error.line}`;
		case "TempResourceFailed":
			return `Temp resource ${error.operation} failed: ${String(error.cause)}`;
		default: {
			const exhaustive: never = error;
			return exhaustive;
		}
	}
}
