import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const validator = join(root, "tools", "validate-manifest", "index.mjs");
const goldenDir = join(root, "fixtures", "manifests");
const invalidDir = join(root, "fixtures", "invalid-manifests");
const versionOutputDir = join(root, "fixtures", "version-outputs");
const specDir = join(root, "docs", "specs");
const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const namePattern = /^[a-z0-9][a-z0-9-]{1,63}$/;
const ticketPattern = /^DTK-[A-Z]+-\d+$/;
const validKinds = new Set(["cli", "lsp", "mcp", "sidecar", "dap", "tool"]);
const validLanguages = new Set(["rust", "dotnet", "dart", "typescript", "kotlin", "javascript"]);

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function runValidator(path) {
  return spawnSync(process.execPath, [validator, path], {
    cwd: root,
    encoding: "utf8"
  });
}

function listJsonFiles(path) {
  return readdirSync(path)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => join(path, file));
}

function walkFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(child);
    }
    return [child];
  });
}

test("all golden manifests pass schema validation", () => {
  const manifests = listJsonFiles(goldenDir);
  assert.deepEqual(
    manifests.map((file) => relative(goldenDir, file)),
    ["basilisk.json", "dart-mutant.json", "deslop.json", "forge.json", "too-many-cooks.json"]
  );

  for (const manifest of manifests) {
    const result = runValidator(manifest);
    assert.equal(result.status, 0, `${manifest}\n${result.stderr}`);
  }
});

test("all invalid manifests fail schema validation", () => {
  const invalidManifests = listJsonFiles(invalidDir);
  assert.deepEqual(
    invalidManifests.map((file) => relative(invalidDir, file)),
    ["bad-semver.json", "missing-component-id.json", "missing-required-binary.json", "unsupported-platform.json"]
  );

  for (const manifest of invalidManifests) {
    const result = runValidator(manifest);
    assert.notEqual(result.status, 0, `${manifest} unexpectedly passed`);
  }
});

test("plain and JSON version fixtures match the contract", () => {
  const files = walkFiles(versionOutputDir).filter((file) => file.endsWith(".txt") || file.endsWith(".json"));
  assert.equal(files.length, 12);

  const textNames = new Set();
  const jsonNames = new Set();

  for (const file of files) {
    if (file.endsWith(".txt")) {
      const line = readFileSync(file, "utf8").trim();
      const [name, version, extra] = line.split(/\s+/);
      assert.ok(namePattern.test(name), `${file}: invalid binary name`);
      assert.ok(semverPattern.test(version), `${file}: invalid semver`);
      assert.equal(extra, undefined, `${file}: plain output must be one line with name and version`);
      textNames.add(name);
      continue;
    }

    const output = json(file);
    assert.equal(output.manifestVersion, 1, `${file}: manifestVersion`);
    assert.ok(namePattern.test(output.name), `${file}: name`);
    assert.ok(semverPattern.test(output.version), `${file}: version`);
    assert.ok(validKinds.has(output.kind), `${file}: kind`);
    assert.ok(validLanguages.has(output.language), `${file}: language`);
    assert.ok(Array.isArray(output.capabilities), `${file}: capabilities`);
    jsonNames.add(output.name);
  }

  assert.deepEqual([...textNames].sort(), [...jsonNames].sort());
});

test("each spec file has fixture coverage or a tracked ticket id", () => {
  const coverage = json(join(root, "fixtures", "spec-coverage.json"));
  assert.equal(coverage.manifestVersion, 1);

  const specFiles = readdirSync(specDir)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => `docs/specs/${file}`);

  assert.deepEqual(Object.keys(coverage).filter((key) => key !== "manifestVersion").sort(), specFiles);

  for (const specFile of specFiles) {
    const entry = coverage[specFile];
    assert.ok(ticketPattern.test(entry.defaultTicket), `${specFile}: missing tracked ticket id`);
    assert.ok(entry.fixtures.length > 0, `${specFile}: missing fixture references`);
    for (const fixture of entry.fixtures) {
      assert.ok(existsSync(join(root, fixture)), `${specFile}: missing coverage fixture ${fixture}`);
    }

    const actionableLines = readFileSync(join(root, specFile), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("Status:") && !line.startsWith("```"));

    assert.ok(actionableLines.length > 0, `${specFile}: no spec lines found`);
  }
});
