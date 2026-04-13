import * as fs from "node:fs";
import * as path from "node:path";
import type { ActiveBrain, MemoryBrainConfig, MemoryBrainDefinition, MemoryProjectMapping } from "./types.js";

export const MEMORY_CONFIG_FILE = path.join(".pi", "memory-config.json");

function expandHome(inputPath: string, homeDir: string): string {
  if (inputPath === "~") return homeDir;
  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return path.join(homeDir, inputPath.slice(2));
  }
  return inputPath;
}

function normalizePath(inputPath: string): string {
  return path.resolve(inputPath);
}

function normalizeBrainDefinition(definition: MemoryBrainDefinition, homeDir: string): MemoryBrainDefinition {
  return {
    path: normalizePath(expandHome(definition.path, homeDir)),
  };
}

function normalizeProjectMapping(mapping: MemoryProjectMapping): MemoryProjectMapping {
  return {
    projectPath: normalizePath(mapping.projectPath),
    brain: mapping.brain,
  };
}

function defaultConfig(homeDir: string): MemoryBrainConfig {
  return {
    defaultBrain: "main",
    brains: {
      main: {
        path: path.join(homeDir, ".pi", "memories"),
      },
    },
    projectMappings: [],
  };
}

function normalizeConfig(config: MemoryBrainConfig, homeDir: string): MemoryBrainConfig {
  const brains = Object.fromEntries(
    Object.entries(config.brains).map(([name, definition]) => [name, normalizeBrainDefinition(definition, homeDir)]),
  );

  const normalized: MemoryBrainConfig = {
    defaultBrain: config.defaultBrain,
    brains,
    projectMappings: config.projectMappings.map(normalizeProjectMapping),
  };

  validateConfig(normalized);
  return normalized;
}

function validateConfig(config: MemoryBrainConfig): void {
  if (!config.brains[config.defaultBrain]) {
    throw new Error(`Unknown default brain: ${config.defaultBrain}`);
  }

  for (const mapping of config.projectMappings) {
    if (!config.brains[mapping.brain]) {
      throw new Error(`Unknown brain in project mapping: ${mapping.brain}`);
    }
  }
}

export function loadMemoryConfig(homeDir: string): MemoryBrainConfig {
  const configPath = path.join(homeDir, MEMORY_CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return defaultConfig(homeDir);
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw) as MemoryBrainConfig;
  return normalizeConfig(parsed, homeDir);
}

export function saveMemoryConfig(homeDir: string, config: MemoryBrainConfig): void {
  const configPath = path.join(homeDir, MEMORY_CONFIG_FILE);
  const normalized = normalizeConfig(config, homeDir);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2) + "\n");
}

export function resolveActiveBrain(config: MemoryBrainConfig, projectPath: string): ActiveBrain {
  validateConfig(config);

  const normalizedProjectPath = normalizePath(projectPath);
  const mapping = config.projectMappings.find((entry) => entry.projectPath === normalizedProjectPath);
  const brainName = mapping?.brain ?? config.defaultBrain;
  const definition = config.brains[brainName];

  if (!definition) {
    throw new Error(`Unknown brain: ${brainName}`);
  }

  return {
    name: brainName,
    vaultDir: definition.path,
    source: mapping ? "mapped" : "default",
  };
}
