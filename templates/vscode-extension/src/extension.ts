import * as vscode from "vscode";
import { activateShipwright } from "@nimblesite/shipwright-vscode";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const deployment = await activateShipwright(context, { vscode });
  if (!deployment.ok) {
    return;
  }

  // Start the real LSP, MCP, commands, and webviews here. Use
  // deployment.diagnostics to read the resolved binary paths.
}

export function deactivate(): void {}
