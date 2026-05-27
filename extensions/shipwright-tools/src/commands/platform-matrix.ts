import * as vscode from "vscode";
import type { ShipwrightManifest, PlatformId } from "../types";
import { tryParseManifest, ALL_PLATFORMS } from "../types";

export function registerPlatformMatrixCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  const cmd = vscode.commands.registerCommand("shipwright.platformMatrix", async () => {
    const files = await vscode.workspace.findFiles("**/shipwright.json", "**/node_modules/**", 1);
    if (files.length === 0) {
      vscode.window.showWarningMessage("No shipwright.json found in workspace.");
      return;
    }
    const doc = await vscode.workspace.openTextDocument(files[0]);
    const manifest = tryParseManifest(doc.getText());
    if (!manifest) {
      vscode.window.showErrorMessage("Failed to parse shipwright.json");
      return;
    }
    showMatrixPanel(context, manifest);
  });
  return [cmd];
}

function showMatrixPanel(
  context: vscode.ExtensionContext,
  manifest: ShipwrightManifest,
): void {
  const panel = vscode.window.createWebviewPanel(
    "shipwright.platformMatrix",
    `Platform Matrix — ${manifest.product.displayName ?? manifest.product.id}`,
    vscode.ViewColumn.One,
    { enableScripts: false },
  );
  panel.webview.html = buildMatrixHtml(manifest);
  context.subscriptions.push(panel);
}

function buildMatrixHtml(manifest: ShipwrightManifest): string {
  const platforms = ALL_PLATFORMS.filter((p) => p !== "all");
  const hasAll = manifest.components.some(
    (c) => c.platforms?.includes("all"),
  );
  const cols: PlatformId[] = hasAll ? [...platforms, "all"] : platforms;

  const headerCells = cols.map((p) => `<th class="plat">${shortPlatform(p)}</th>`).join("");
  const rows = manifest.components.map((comp) => {
    const cells = cols.map((p) => {
      const has = comp.platforms?.includes(p) ?? false;
      return `<td class="${has ? "yes" : "no"}">${has ? "&#10003;" : ""}</td>`;
    }).join("");
    const badge = `<span class="badge badge-${comp.kind}">${comp.kind}</span>`;
    return `<tr><td class="comp-id">${comp.id} ${badge}</td>${cells}</tr>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
  h1 { font-size: 1.4em; margin-bottom: 4px; }
  .subtitle { opacity: 0.7; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid var(--vscode-panel-border, #444); padding: 6px 10px; text-align: center; }
  th { background: var(--vscode-editor-selectionBackground, #264f78); font-size: 0.85em; }
  .comp-id { text-align: left; font-weight: 600; white-space: nowrap; }
  .plat { writing-mode: vertical-rl; text-orientation: mixed; min-width: 36px; }
  .yes { color: var(--vscode-testing-iconPassed, #73c991); font-weight: bold; }
  .no { opacity: 0.2; }
  .badge { font-size: 0.75em; padding: 2px 6px; border-radius: 3px; margin-left: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
</style>
</head>
<body>
  <h1>${manifest.product.displayName ?? manifest.product.id}</h1>
  <div class="subtitle">v${manifest.product.version} &mdash; ${manifest.components.length} component(s)</div>
  <table>
    <thead><tr><th>Component</th>${headerCells}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function shortPlatform(p: string): string {
  const map: Record<string, string> = {
    "darwin-arm64": "macOS ARM",
    "darwin-x64": "macOS x64",
    "linux-x64": "Linux x64",
    "linux-arm64": "Linux ARM",
    "win32-x64": "Win x64",
    "win32-arm64": "Win ARM",
    "all": "All",
  };
  return map[p] ?? p;
}
