import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activateShipwright, type ExecFile, type VscodeApiLike } from "../src/index.js";

const tempRoots: string[] = [];

afterEach(() => {
  tempRoots.length = 0;
});

describe("activateShipwright", () => {
  it("loads shipwright.json and accepts a matching bundled binary", async () => {
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

    const result = await activateShipwright(
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

    const result = await activateShipwright(
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

  it("resolves bundled binary on win32-x64 with backslash paths (the Basilisk Windows bug)", async () => {
    const root = await extensionRootWithManifest({
      components: [
        {
          id: "basilisk",
          kind: "lsp",
          binaryName: "basilisk",
          expectedVersion: "${PRODUCT_VERSION}",
          platforms: ["win32-x64"],
          bundled: { bundlePath: "bin/${platform}/${binaryName}${exe}" },
          sources: ["bundled", "pkgmgr"],
          pkgmgr: { scoop: "basilisk" },
          required: true
        }
      ],
      hosts: {
        vscode: {
          activationVerifies: ["basilisk"],
          onMismatch: "error"
        }
      }
    });

    const probedFiles: string[] = [];
    const execFile: ExecFile = (file, _args, _options, callback) => {
      probedFiles.push(file);
      callback(null, "basilisk 0.1.0\n", "");
    };
    const vscode = fakeVscode();

    const result = await activateShipwright(
      { extensionUri: { fsPath: root } },
      { env: { PATH: "" }, execFile, platform: "win32-x64", vscode: vscode.api }
    );

    // The fix: activation MUST succeed — the probe Map key and the
    // resolve lookup key must match, even on Windows.
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(1);

    const diag = result.diagnostics[0]!;
    expect(diag.blocking).toBe(false);
    expect(diag.componentId).toBe("basilisk");
    expect(diag.resolution.source).toBe("bundled");
    expect(diag.resolution.status).toBe("ok");
    expect(diag.resolution.version).toBe("0.1.0");

    // The resolved path MUST use backslashes on Windows — no mixed separators.
    const resolvedPath = diag.resolution.path;
    expect(resolvedPath).toBeDefined();
    expect(resolvedPath).toContain("\\bin\\win32-x64\\basilisk.exe");
    expect(resolvedPath).toMatch(/\\basilisk\.exe$/);

    // The probe MUST have been called (if it wasn't, the cascade fell through).
    expect(probedFiles).toHaveLength(1);
    expect(probedFiles[0]).toContain("basilisk.exe");
    expect(probedFiles[0]).toContain("win32-x64");

    // No errors or warnings should have been shown.
    expect(vscode.errors).toEqual([]);
    expect(vscode.warnings).toEqual([]);
  });

  it("resolves bundled binary on win32-arm64 with backslash paths", async () => {
    const root = await extensionRootWithManifest({
      components: [
        {
          id: "basilisk",
          kind: "lsp",
          binaryName: "basilisk",
          expectedVersion: "${PRODUCT_VERSION}",
          platforms: ["win32-arm64"],
          bundled: { bundlePath: "bin/${platform}/${binaryName}${exe}" },
          sources: ["bundled"],
          required: true
        }
      ],
      hosts: {
        vscode: {
          activationVerifies: ["basilisk"],
          onMismatch: "error"
        }
      }
    });
    const execFile: ExecFile = (_file, _args, _options, callback) => {
      callback(null, "basilisk 0.1.0\n", "");
    };
    const vscode = fakeVscode();

    const result = await activateShipwright(
      { extensionUri: { fsPath: root } },
      { env: { PATH: "" }, execFile, platform: "win32-arm64", vscode: vscode.api }
    );

    expect(result.ok).toBe(true);
    const diag = result.diagnostics[0]!;
    expect(diag.resolution.source).toBe("bundled");
    expect(diag.resolution.status).toBe("ok");
    expect(diag.resolution.version).toBe("0.1.0");
    expect(diag.resolution.path).toContain("\\bin\\win32-arm64\\basilisk.exe");
    expect(diag.resolution.path).toMatch(/\\basilisk\.exe$/);
    expect(vscode.errors).toEqual([]);
  });

  it("resolves PATH binary on win32-x64 with backslash entries", async () => {
    const root = await extensionRootWithManifest({
      components: [
        {
          id: "tool",
          kind: "lsp",
          binaryName: "tool",
          expectedVersion: "2.0.0",
          platforms: ["win32-x64"],
          sources: ["path"],
          required: true
        }
      ],
      hosts: {
        vscode: {
          activationVerifies: ["tool"],
          onMismatch: "error"
        }
      }
    });

    const probedFiles: string[] = [];
    const execFile: ExecFile = (file, _args, _options, callback) => {
      probedFiles.push(file);
      callback(null, "tool 2.0.0\n", "");
    };
    const vscode = fakeVscode();

    const result = await activateShipwright(
      { extensionUri: { fsPath: root } },
      {
        env: { PATH: "" },
        pathEntries: ["C:\\Users\\dev\\scoop\\shims"],
        execFile,
        platform: "win32-x64",
        vscode: vscode.api
      }
    );

    expect(result.ok).toBe(true);
    const diag = result.diagnostics[0]!;
    expect(diag.resolution.source).toBe("path");
    expect(diag.resolution.status).toBe("ok");
    expect(diag.resolution.path).toBe("C:\\Users\\dev\\scoop\\shims\\tool.exe");
    expect(diag.resolution.path).not.toContain("/tool");

    expect(probedFiles).toHaveLength(1);
    expect(probedFiles[0]).toBe("C:\\Users\\dev\\scoop\\shims\\tool.exe");
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

    const result = await activateShipwright(
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
  const root = await mkdtemp(path.join(os.tmpdir(), "shipwright-vscode-"));
  tempRoots.push(root);
  await writeFile(
    path.join(root, "shipwright.json"),
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
