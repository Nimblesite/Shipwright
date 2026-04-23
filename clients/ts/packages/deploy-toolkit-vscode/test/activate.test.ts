import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activateDeploymentToolkit, type ExecFile, type VscodeApiLike } from "../src/index.js";

const tempRoots: string[] = [];

afterEach(() => {
  tempRoots.length = 0;
});

describe("activateDeploymentToolkit", () => {
  it("loads deployment-toolkit.json and accepts a matching bundled binary", async () => {
    const root = await extensionRootWithManifest({
      components: [
        {
          id: "deslop-lsp",
          kind: "lsp",
          binaryName: "deslop-lsp",
          expectedVersion: "${PRODUCT_VERSION}",
          platforms: ["darwin-arm64"],
          bundled: { bundlePath: "bin/${platform}/${binaryName}${exe}" },
          sources: ["bundled"],
          required: true
        }
      ],
      hosts: {
        vscode: {
          activationVerifies: ["deslop-lsp"],
          onMismatch: "error"
        }
      }
    });
    const vscode = fakeVscode();
    const execFile: ExecFile = (_file, _args, _options, callback) => {
      callback(null, "deslop-lsp 0.1.0\n", "");
    };

    const result = await activateDeploymentToolkit(
      { extensionUri: { fsPath: root } },
      { env: { PATH: "" }, execFile, platform: "darwin-arm64", vscode: vscode.api }
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics[0]?.resolution).toMatchObject({
      source: "bundled",
      status: "ok",
      version: "0.1.0"
    });
    expect(vscode.errors).toEqual([]);
    expect(vscode.warnings).toEqual([]);
  });

  it("blocks and reports a modal error for a configured path version mismatch", async () => {
    const root = await extensionRootWithManifest({
      components: [
        {
          id: "deslop-lsp",
          kind: "lsp",
          binaryName: "deslop-lsp",
          expectedVersion: "0.1.0",
          platforms: ["darwin-arm64"],
          sources: ["user-setting", "bundled"],
          userSetting: "deslop.lspPath",
          bundled: { bundlePath: "bin/${platform}/${binaryName}${exe}" },
          required: true
        }
      ],
      hosts: {
        vscode: {
          activationVerifies: ["deslop-lsp"],
          onMismatch: "error"
        }
      }
    });
    const vscode = fakeVscode({ "deslop.lspPath": "/custom/deslop-lsp" });
    const execFile: ExecFile = (_file, _args, _options, callback) => {
      callback(null, "deslop-lsp 0.0.9\n", "");
    };

    const result = await activateDeploymentToolkit(
      { extensionUri: { fsPath: root } },
      { env: { PATH: "" }, execFile, platform: "darwin-arm64", vscode: vscode.api }
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.resolution).toMatchObject({
      errorCode: "user-setting-version-mismatch",
      status: "error"
    });
    expect(vscode.errors).toHaveLength(1);
    expect(vscode.errors[0]?.message).toContain("Expected 0.1.0; found 0.0.9 at /custom/deslop-lsp");
    expect(vscode.errors[0]?.options).toEqual({ modal: true });
  });

  it("uses modal repair prompts for package-manager actions", async () => {
    const root = await extensionRootWithManifest({
      components: [
        {
          id: "dart-mutant-cli",
          kind: "cli",
          binaryName: "dart-mutant",
          expectedVersion: "0.1.0",
          platforms: ["darwin-arm64"],
          sources: ["pkgmgr"],
          pkgmgr: {
            brew: "Nimblesite/tap/dart-mutant"
          },
          required: true
        }
      ],
      hosts: {
        vscode: {
          activationVerifies: ["dart-mutant-cli"],
          onMismatch: "prompt-pkgmgr"
        }
      }
    });
    const vscode = fakeVscode();

    const result = await activateDeploymentToolkit(
      { extensionUri: { fsPath: root } },
      { env: { PATH: "" }, platform: "darwin-arm64", vscode: vscode.api }
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.resolution).toMatchObject({
      status: "prompt"
    });
    expect(vscode.warnings).toHaveLength(1);
    expect(vscode.warnings[0]?.items).toEqual(["brew install Nimblesite/tap/dart-mutant"]);
  });
});

async function extensionRootWithManifest(partial: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "deploy-toolkit-vscode-"));
  tempRoots.push(root);
  await writeFile(
    path.join(root, "deployment-toolkit.json"),
    JSON.stringify({
      manifestVersion: 1,
      product: {
        id: "deslop",
        displayName: "Deslop",
        version: "0.1.0"
      },
      ...partial
    })
  );
  return root;
}

function fakeVscode(settings: Record<string, string> = {}): {
  api: VscodeApiLike;
  errors: Array<{ items: string[]; message: string; options: { modal: boolean } }>;
  warnings: Array<{ items: string[]; message: string; options: { modal: boolean } }>;
} {
  const errors: Array<{ items: string[]; message: string; options: { modal: boolean } }> = [];
  const warnings: Array<{ items: string[]; message: string; options: { modal: boolean } }> = [];
  return {
    api: {
      workspace: {
        getConfiguration: () => ({
          get: <T>(key: string) => settings[key] as T | undefined
        })
      },
      window: {
        showErrorMessage: (message, options, ...items) => {
          errors.push({ items, message, options });
          return undefined;
        },
        showWarningMessage: (message, options, ...items) => {
          warnings.push({ items, message, options });
          return undefined;
        }
      }
    },
    errors,
    warnings
  };
}
