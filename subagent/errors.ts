import { Data } from "effect";

export class InvalidSubagentRequest extends Data.TaggedError("InvalidSubagentRequest")<{
	readonly message: string;
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

export class TempResourceFailed extends Data.TaggedError("TempResourceFailed")<{
	readonly operation: string;
	readonly cause: unknown;
}> {}
