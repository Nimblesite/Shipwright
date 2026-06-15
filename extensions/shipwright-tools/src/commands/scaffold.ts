import * as vscode from "vscode";
import type { ComponentKind, Language } from "../types";

interface ScaffoldInput {
  productId: string;
  displayName: string;
  version: string;
  componentKind: ComponentKind;
  language: Language;
}

export function registerScaffoldCommand(): vscode.Disposable[] {
  const cmd = vscode.commands.registerCommand("shipwright.scaffold", async () => {
    const input = await gatherInput();
    if (!input) {
      return;
    }
    const manifest = buildManifest(input);
    const json = JSON.stringify(manifest, null, 2) + "\n";
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      const doc = await vscode.workspace.openTextDocument({ content: json, language: "json" });
      await vscode.window.showTextDocument(doc);
      return;
    }
    const uri = vscode.Uri.joinPath(folder.uri, "shipwright.json");
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(json));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  });

  const addComp = vscode.commands.registerCommand("shipwright.addComponent", async () => {
    const files = await vscode.workspace.findFiles("**/shipwright.json", "**/node_modules/**", 1);
    if (files.length === 0) {
      vscode.window.showWarningMessage('No shipwright.json found. Run "Shipwright: Create New Manifest" first.');
      return;
    }
    const doc = await vscode.workspace.openTextDocument(files[0]);
    await vscode.commands.executeCommand("vscode.openWith", doc.uri, "shipwright.manifestEditor");
  });

  return [cmd, addComp];
}

async function gatherInput(): Promise<ScaffoldInput | undefined> {
  const productId = await vscode.window.showInputBox({ prompt: "Product ID (kebab-case)", placeHolder: "my-product" });
  if (!productId) {
    return undefined;
  }

  const displayName = await vscode.window.showInputBox({
    prompt: "Display name",
    placeHolder: "My Product",
    value: titleCase(productId),
  });
  if (displayName === undefined) {
    return undefined;
  }

  const version = await vscode.window.showInputBox({ prompt: "Version", placeHolder: "0.1.0", value: "0.1.0" });
  if (!version) {
    return undefined;
  }

  const kindPick = await vscode.window.showQuickPick(["lsp", "cli", "mcp", "sidecar", "dap", "tool"], {
    placeHolder: "Primary component kind",
  });
  if (!kindPick) {
    return undefined;
  }

  const langPick = await vscode.window.showQuickPick(["rust", "dotnet", "typescript", "dart", "kotlin", "javascript"], {
    placeHolder: "Implementation language",
  });
  if (!langPick) {
    return undefined;
  }

  return {
    productId,
    displayName: displayName || productId,
    version,
    componentKind: kindPick as ComponentKind,
    language: langPick as Language,
  };
}

function buildManifest(input: ScaffoldInput): Record<string, unknown> {
  const compId = input.componentKind === "cli" ? input.productId : `${input.productId}-${input.componentKind}`;

  return {
    manifestVersion: 1,
    product: {
      id: input.productId,
      displayName: input.displayName,
      version: input.version,
    },
    components: [
      {
        id: compId,
        kind: input.componentKind,
        language: input.language,
        binaryName: compId,
        expectedVersion: input.version,
        platforms: ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64", "win32-arm64"],
        sources: defaultSources(input.componentKind),
        verifyStartup: true,
        versionCheckStrategy: input.componentKind === "lsp" ? "lsp-initialize" : "version-flag",
        required: true,
      },
    ],
    hosts: {
      vscode: {
        artifact: "vsix-per-platform",
        activationVerifies: [compId],
        onMismatch: "error",
      },
    },
  };
}

function defaultSources(kind: ComponentKind): string[] {
  if (kind === "lsp" || kind === "mcp" || kind === "dap") {
    return ["user-setting", "env", "bundled", "path"];
  }
  return ["path", "cargo-bin"];
}

function titleCase(kebab: string): string {
  return kebab
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
