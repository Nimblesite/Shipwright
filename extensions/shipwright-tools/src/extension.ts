import * as vscode from "vscode";
import { ManifestEditorProvider } from "./editor/provider";
import { ManifestTreeProvider } from "./tree/manifest-tree";
import { registerValidation } from "./validation/diagnostics";
import { registerScaffoldCommand } from "./commands/scaffold";
import { registerPlatformMatrixCommand } from "./commands/platform-matrix";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Shipwright Tools", { log: true });

  context.subscriptions.push(
    ManifestEditorProvider.register(context),
    ...ManifestTreeProvider.register(context, output),
    ...registerValidation(context, output),
    ...registerScaffoldCommand(),
    ...registerPlatformMatrixCommand(context),
    output
  );

  output.info("Shipwright Tools activated");
}

export function deactivate(): void {
  /* nothing to clean up */
}
