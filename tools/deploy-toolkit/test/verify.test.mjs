import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { verifyBinaries, verifyExtensionPackage } from "../index.mjs";

test("verify-binaries runs --version and checks component id plus version", async () => {
  const root = await fixtureRoot();
  const manifest = writeManifest(root);
  const binDir = join(root, "bin", "darwin-arm64");
  mkdirSync(binDir, { recursive: true });
  const binary = join(binDir, "example-lsp");
  writeFileSync(binary, "#!/usr/bin/env sh\necho 'example-lsp 1.2.3'\n");
  chmodSync(binary, 0o755);

  assert.deepEqual(
    verifyBinaries({ manifest, platform: "darwin-arm64", root, components: [] }),
    { ok: true, value: "verified 1 binaries" }
  );
});

test("verify-binaries rejects version drift", async () => {
  const root = await fixtureRoot();
  const manifest = writeManifest(root);
  const binDir = join(root, "bin", "darwin-arm64");
  mkdirSync(binDir, { recursive: true });
  const binary = join(binDir, "example-lsp");
  writeFileSync(binary, "#!/usr/bin/env sh\necho 'example-lsp 1.2.2'\n");
  chmodSync(binary, 0o755);

  const result = verifyBinaries({ manifest, platform: "darwin-arm64", root, components: [] });
  assert.equal(result.ok, false);
  assert.match(result.error, /expected 1\.2\.3, found 1\.2\.2/);
});

test("verify-extension-package checks manifest and declared bundled binaries", async () => {
  const root = await fixtureRoot();
  const manifest = writeManifest(root);
  mkdirSync(join(root, "package", "bin", "darwin-arm64"), { recursive: true });
  writeFileSync(join(root, "package", "deployment-toolkit.json"), "{}\n");
  writeFileSync(join(root, "package", "bin", "darwin-arm64", "example-lsp"), "");

  assert.deepEqual(
    await verifyExtensionPackage({ manifest, platform: "darwin-arm64", packagePath: join(root, "package") }),
    { ok: true, value: "verified package with 1 bundled binaries" }
  );
});

test("verify-extension-package rejects undeclared binaries", async () => {
  const root = await fixtureRoot();
  const manifest = writeManifest(root);
  mkdirSync(join(root, "package", "bin", "darwin-arm64"), { recursive: true });
  writeFileSync(join(root, "package", "deployment-toolkit.json"), "{}\n");
  writeFileSync(join(root, "package", "bin", "darwin-arm64", "example-lsp"), "");
  writeFileSync(join(root, "package", "bin", "darwin-arm64", "other-lsp"), "");

  const result = await verifyExtensionPackage({ manifest, platform: "darwin-arm64", packagePath: join(root, "package") });
  assert.equal(result.ok, false);
  assert.match(result.error, /undeclared binary/);
});

async function fixtureRoot() {
  return mkdtemp(join(tmpdir(), "deploy-toolkit-cli-"));
}

function writeManifest(root) {
  const manifest = join(root, "deployment-toolkit.json");
  writeFileSync(
    manifest,
    JSON.stringify({
      manifestVersion: 1,
      product: { id: "example", version: "1.2.3" },
      components: [
        {
          id: "example-lsp",
          kind: "lsp",
          binaryName: "example-lsp",
          expectedVersion: "${PRODUCT_VERSION}",
          platforms: ["darwin-arm64"],
          bundled: { bundlePath: "bin/${platform}/${binaryName}${exe}" },
          sources: ["bundled"],
          required: true
        }
      ],
      hosts: { vscode: { artifact: "vsix-per-platform", activationVerifies: ["example-lsp"] } }
    })
  );
  return manifest;
}
