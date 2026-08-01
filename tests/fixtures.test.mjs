import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const validator = join(root, "tools", "validate-manifest", "index.mjs");
const goldenDir = join(root, "fixtures", "manifests");
const invalidDir = join(root, "fixtures", "invalid-manifests");
const versionOutputDir = join(root, "fixtures", "version-outputs");
const specDir = join(root, "docs", "specs");
const workflowDir = join(root, ".github", "workflows");
const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const namePattern = /^[a-z0-9][a-z0-9-]{1,63}$/;
const trackedIdPattern = /^SWR-[A-Z]+(?:-[A-Z]+)+$/;
const illegalNumericTrackedIdPattern = /\bSWR-[A-Z]+-\d+\b/g;
const validKinds = new Set(["cli", "lsp", "mcp", "sidecar", "dap", "tool"]);
const validLanguages = new Set(["rust", "dotnet", "dart", "typescript", "kotlin", "javascript"]);
const scoopHeredoc = "node - <<'NODE'";
const scoopWriterEnv = {
  MANIFEST_NAME: "sampletool",
  VERSION: "1.2.3",
  DESCRIPTION: "Sample tool",
  HOMEPAGE: "https://example.invalid/sampletool",
  URL: "https://example.invalid/sampletool-1.2.3-win32-x64.zip",
  SHA256: "d713ca72419bc535e6c64605381255e544553356290b900b6c3f1eed21bee735",
  BIN: "sampletool.exe"
};

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

// Runs a workflow's embedded Scoop-manifest writer the way the runner does: the
// `node - <<'NODE'` heredoc is executed with the step's environment, and the file
// it emits is parsed. Asserting on the emitted manifest rather than on workflow
// text is what makes an undeclared field visible at all. `.cjs` because the
// heredoc is CommonJS while this package is ESM.
function runScoopManifestWriter(workflowPath, overrides) {
  const workflow = readFileSync(workflowPath, "utf8");
  const opener = workflow.indexOf(scoopHeredoc);
  assert.ok(opener >= 0, `${workflowPath}: no embedded Scoop manifest writer`);
  const bodyStart = opener + scoopHeredoc.length;
  const directory = mkdtempSync(join(tmpdir(), "shipwright-scoop-"));
  const script = join(directory, "write-manifest.cjs");
  writeFileSync(script, workflow.slice(bodyStart, workflow.indexOf("NODE", bodyStart)));
  const environment = { ...process.env, ...scoopWriterEnv, ...overrides };
  const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: "utf8", env: environment });
  assert.equal(result.status, 0, `${workflowPath}\n${result.stderr}`);
  return json(join(directory, "bucket", `${environment.MANIFEST_NAME}.json`));
}

// SWR-REL-SCOOP: Scoop resolves `bin` from the app root, so a release archive
// that nests its payload under a top-level directory needs that directory named
// in `extract_dir` — without it the download and hash check pass and shim
// creation then fails. Both writers must support it: the template downstream
// products vendor, and Shipwright's own reusable release workflow. A single-file
// archive is flat, so an empty value must omit the key rather than emit "".
test("scoop manifest writers declare extract_dir for nested archives", () => {
  for (const workflow of [
    join(root, "templates", "gh-actions", "publish-scoop-bucket.yml"),
    join(workflowDir, "release.reusable.yml")
  ]) {
    const nested = runScoopManifestWriter(workflow, { EXTRACT_DIR: "sampletool-1.2.3-win32-x64" });
    assert.equal(nested.architecture["64bit"].url, scoopWriterEnv.URL, workflow);
    assert.equal(nested.architecture["64bit"].hash, scoopWriterEnv.SHA256, workflow);
    assert.equal(nested.bin, scoopWriterEnv.BIN, workflow);
    assert.equal(nested.architecture["64bit"].extract_dir, "sampletool-1.2.3-win32-x64", workflow);

    const flat = runScoopManifestWriter(workflow, { EXTRACT_DIR: "" });
    assert.equal("extract_dir" in flat.architecture["64bit"], false, workflow);
  }
});

test("all golden manifests pass schema validation", () => {
  const manifests = listJsonFiles(goldenDir);
  assert.deepEqual(
    manifests.map((file) => relative(goldenDir, file)),
    ["basilisk.json", "dart-mutant.json", "deslop.json", "sharplsp.json", "too-many-cooks.json"]
  );

  for (const manifest of manifests) {
    const result = runValidator(manifest);
    assert.equal(result.status, 0, `${manifest}\n${result.stderr}`);
  }
});

test("Deslop manifest covers VS Code and JetBrains pilots", () => {
  const manifest = json(join(goldenDir, "deslop.json"));
  const components = new Map(manifest.components.map((component) => [component.id, component]));

  assert.equal(components.get("deslop-vscode")?.kind, "extension-vscode");
  assert.equal(components.get("deslop-jetbrains")?.kind, "extension-jetbrains");
  assert.deepEqual(manifest.hosts.vscode.activationVerifies, ["deslop-lsp", "deslop-mcp"]);
  assert.deepEqual(manifest.hosts.jetbrains.activationVerifies, ["deslop-lsp"]);
});

test("release reusable workflow owns release orchestration", () => {
  const releaseWorkflow = readFileSync(join(workflowDir, "release.reusable.yml"), "utf8");
  const smokeWorkflow = readFileSync(join(workflowDir, "smoke.reusable.yml"), "utf8");

  assert.equal(releaseWorkflow.includes("templates/gh-actions"), false);
  assert.equal(releaseWorkflow.includes("tap_push_token"), false);
  assert.equal(releaseWorkflow.includes("bucket_push_token"), false);
  assert.equal(releaseWorkflow.includes("  target-matrix:"), true);
  assert.equal(smokeWorkflow.includes("matrix.platform"), true);
  assert.equal(smokeWorkflow.includes("matrix.target"), false);
});

test("all invalid manifests fail schema validation", () => {
  const invalidManifests = listJsonFiles(invalidDir);
  assert.deepEqual(
    invalidManifests.map((file) => relative(invalidDir, file)),
    ["bad-semver.json", "bad-supplychain.json", "missing-component-id.json", "missing-required-binary.json", "unsupported-platform.json"]
  );

  for (const manifest of invalidManifests) {
    const result = runValidator(manifest);
    assert.notEqual(result.status, 0, `${manifest} unexpectedly passed`);
  }
});

test("plain and JSON version fixtures match the contract", () => {
  const files = walkFiles(versionOutputDir).filter((file) => file.endsWith(".txt") || file.endsWith(".json"));
  assert.equal(files.length, 16);

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
    assert.ok(trackedIdPattern.test(entry.defaultTicket), `${specFile}: missing semantic tracked ticket id`);
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

test("tracked SWR ids do not use numeric suffixes", () => {
  const files = [
    ...walkFiles(join(root, "docs", "plans")).filter((file) => file.endsWith(".md")),
    ...walkFiles(specDir).filter((file) => file.endsWith(".md")),
    join(root, "fixtures", "spec-coverage.json")
  ];

  const illegalIds = files.flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(illegalNumericTrackedIdPattern)].map((match) => `${relative(root, file)}: ${match[0]}`);
  });

  assert.deepEqual(illegalIds, []);
});
