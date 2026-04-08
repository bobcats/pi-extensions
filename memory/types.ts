export type OperationType = "reflect" | "ruminate" | "dream" | "ingest";
export type OperationStatus = "keep" | "noop" | "cancelled" | "error";

export interface OperationResult {
  type: OperationType;
  status: OperationStatus;
  description: string;
  findingsCount: number;
  filesChanged: string[];
  durationMs: number;
  timestamp: number;
  /** Dream cycle number, if applicable */
  cycle?: number;
}

export interface MemoryState {
  operations: OperationResult[];
  dreamCycle: number;
}

export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
}

export interface DateFilter {
  fromDate?: Date;
  toDate?: Date;
}

export interface ExtractionResult {
  conversationCount: number;
  batches: string[]; // paths to batch manifest files
  outputDir: string;
  snapshotPath: string;
}
