import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadMemoryConfig, resolveActiveBrain, saveMemoryConfig } from "./config.ts";

function tmpHomeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memory-config-home-"));
}

test("loadMemoryConfig returns implicit main brain config when file is absent", () => {
  // Arrange
  const homeDir = "/tmp/home";

  // Act
  const config = loadMemoryConfig(homeDir);

  // Assert
  assert.equal(config.defaultBrain, "main");
  assert.equal(config.brains.main.path, path.join(homeDir, ".pi", "memories"));
});

test("resolveActiveBrain prefers explicit project mapping over default", () => {
  // Arrange
  const homeDir = tmpHomeDir();
  const config = {
    defaultBrain: "main",
    brains: {
      main: { path: path.join(homeDir, ".pi", "memories") },
      poe: { path: path.join(homeDir, ".pi", "memory-brains", "poe") },
    },
    projectMappings: [
      { projectPath: "/tmp/project", brain: "poe" },
    ],
  };

  // Act
  const activeBrain = resolveActiveBrain(config, "/tmp/project");

  // Assert
  assert.equal(activeBrain.name, "poe");
  assert.equal(activeBrain.vaultDir, path.join(homeDir, ".pi", "memory-brains", "poe"));
  assert.equal(activeBrain.source, "mapped");
});

test("resolveActiveBrain throws for unknown mapped brain", () => {
  // Arrange
  const config = {
    defaultBrain: "main",
    brains: {
      main: { path: "/tmp/home/.pi/memories" },
    },
    projectMappings: [
      { projectPath: "/tmp/project", brain: "poe" },
    ],
  };

  // Act + Assert
  assert.throws(() => resolveActiveBrain(config, "/tmp/project"), /Unknown brain in project mapping: poe/);
});

test("loadMemoryConfig expands additional brain paths under ~/.pi/memory-brains", () => {
  // Arrange
  const homeDir = tmpHomeDir();
  const configPath = path.join(homeDir, ".pi", "memory-config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    defaultBrain: "main",
    brains: {
      main: { path: "~/.pi/memories" },
      poe: { path: "~/.pi/memory-brains/poe" },
    },
    projectMappings: [],
  }));

  // Act
  const config = loadMemoryConfig(homeDir);

  // Assert
  assert.equal(config.brains.poe.path, path.join(homeDir, ".pi", "memory-brains", "poe"));
});

test("saveMemoryConfig round-trips JSON without dropping mappings", () => {
  // Arrange
  const homeDir = tmpHomeDir();
  const config = {
    defaultBrain: "main",
    brains: {
      main: { path: path.join(homeDir, ".pi", "memories") },
      poe: { path: path.join(homeDir, ".pi", "memory-brains", "poe") },
    },
    projectMappings: [
      { projectPath: "/tmp/project", brain: "poe" },
    ],
  };

  // Act
  saveMemoryConfig(homeDir, config);
  const reloaded = loadMemoryConfig(homeDir);

  // Assert
  assert.deepEqual(reloaded, {
    defaultBrain: "main",
    brains: {
      main: { path: path.join(homeDir, ".pi", "memories") },
      poe: { path: path.join(homeDir, ".pi", "memory-brains", "poe") },
    },
    projectMappings: [
      { projectPath: path.resolve("/tmp/project"), brain: "poe" },
    ],
  });
});
