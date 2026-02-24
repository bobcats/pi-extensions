import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export type GitStatusEntry = {
	status: string;
	exists: boolean;
	isDirectory: boolean;
};

export type ExecResult = {
	code: number;
	stdout: string;
	stderr?: string;
};

export type ExecFn = (
	cmd: string,
	args: string[],
	opts?: { cwd?: string },
) => Promise<ExecResult>;

export const splitNullSeparated = (value: string): string[] => value.split("\0").filter(Boolean);

export const toCanonicalPath = (inputPath: string): { canonicalPath: string; isDirectory: boolean } | null => {
	if (!existsSync(inputPath)) {
		return null;
	}

	try {
		const canonicalPath = realpathSync(inputPath);
		const stats = statSync(canonicalPath);
		return { canonicalPath, isDirectory: stats.isDirectory() };
	} catch {
		return null;
	}
};

export const toCanonicalPathMaybeMissing = (
	inputPath: string,
): { canonicalPath: string; isDirectory: boolean; exists: boolean } | null => {
	const resolvedPath = path.resolve(inputPath);
	if (!existsSync(resolvedPath)) {
		return { canonicalPath: path.normalize(resolvedPath), isDirectory: false, exists: false };
	}

	try {
		const canonicalPath = realpathSync(resolvedPath);
		const stats = statSync(canonicalPath);
		return { canonicalPath, isDirectory: stats.isDirectory(), exists: true };
	} catch {
		return { canonicalPath: path.normalize(resolvedPath), isDirectory: false, exists: true };
	}
};

export const getGitRoot = async (exec: ExecFn, cwd: string): Promise<string | null> => {
	const result = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
	if (result.code !== 0) {
		return null;
	}

	const root = result.stdout.trim();
	return root ? root : null;
};

export const getGitStatusMap = async (exec: ExecFn, cwd: string): Promise<Map<string, GitStatusEntry>> => {
	const statusMap = new Map<string, GitStatusEntry>();
	const statusResult = await exec("git", ["status", "--porcelain=1", "-z"], { cwd });
	if (statusResult.code !== 0 || !statusResult.stdout) {
		return statusMap;
	}

	const entries = splitNullSeparated(statusResult.stdout);
	for (let i = 0; i < entries.length; i += 1) {
		const entry = entries[i];
		if (!entry || entry.length < 4) continue;
		const status = entry.slice(0, 2);
		const statusLabel = status.replace(/\s/g, "") || status.trim();
		let filePath = entry.slice(3);
		if ((status.startsWith("R") || status.startsWith("C")) && entries[i + 1]) {
			filePath = entries[i + 1];
			i += 1;
		}
		if (!filePath) continue;

		const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
		const canonical = toCanonicalPathMaybeMissing(resolved);
		if (!canonical) continue;
		statusMap.set(canonical.canonicalPath, {
			status: statusLabel,
			exists: canonical.exists,
			isDirectory: canonical.isDirectory,
		});
	}

	return statusMap;
};

export const getGitFiles = async (
	exec: ExecFn,
	gitRoot: string,
): Promise<{ tracked: Set<string>; files: Array<{ canonicalPath: string; isDirectory: boolean }> }> => {
	const tracked = new Set<string>();
	const files: Array<{ canonicalPath: string; isDirectory: boolean }> = [];

	const trackedResult = await exec("git", ["ls-files", "-z"], { cwd: gitRoot });
	if (trackedResult.code === 0 && trackedResult.stdout) {
		for (const relativePath of splitNullSeparated(trackedResult.stdout)) {
			const resolvedPath = path.resolve(gitRoot, relativePath);
			const canonical = toCanonicalPath(resolvedPath);
			if (!canonical) continue;
			tracked.add(canonical.canonicalPath);
			files.push(canonical);
		}
	}

	const untrackedResult = await exec("git", ["ls-files", "-z", "--others", "--exclude-standard"], { cwd: gitRoot });
	if (untrackedResult.code === 0 && untrackedResult.stdout) {
		for (const relativePath of splitNullSeparated(untrackedResult.stdout)) {
			const resolvedPath = path.resolve(gitRoot, relativePath);
			const canonical = toCanonicalPath(resolvedPath);
			if (!canonical) continue;
			files.push(canonical);
		}
	}

	return { tracked, files };
};
