import * as vscode from "vscode";
import type { ShipwrightManifest } from "../types";
import { tryParseManifest } from "../types";
import { buildEditorHtml } from "./html";

export class ManifestEditorProvider implements vscode.CustomTextEditorProvider {
  private static readonly viewType = "shipwright.manifestEditor";

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new ManifestEditorProvider(context);
    const registration = vscode.window.registerCustomEditorProvider(ManifestEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    });
    const openCmd = vscode.commands.registerCommand("shipwright.openVisualEditor", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      await vscode.commands.executeCommand("vscode.openWith", editor.document.uri, ManifestEditorProvider.viewType);
    });
    return vscode.Disposable.from(registration, openCmd);
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
    const webview = webviewPanel.webview;
    webview.options = { enableScripts: true, localResourceRoots: [this.mediaRoot()] };
    webview.html = buildEditorHtml(webview, this.context.extensionUri);
    this.syncDocument(webview, document);

    const changeDoc = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        this.syncDocument(webview, document);
      }
    });

    webview.onDidReceiveMessage((msg: WebviewMessage) => {
      this.handleMessage(msg, document);
    });

    webviewPanel.onDidDispose(() => changeDoc.dispose());
  }

  private mediaRoot(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, "media");
  }

  private syncDocument(webview: vscode.Webview, document: vscode.TextDocument): void {
    const manifest = tryParseManifest(document.getText());
    webview.postMessage({ type: "update", manifest, raw: document.getText() });
  }

  private handleMessage(msg: WebviewMessage, document: vscode.TextDocument): void {
    switch (msg.type) {
      case "edit":
        this.applyEdit(document, msg.path, msg.value);
        break;
      case "addComponent":
        this.addComponent(document, msg.component);
        break;
      case "removeComponent":
        this.removeComponent(document, msg.componentId);
        break;
      case "replaceAll":
        this.replaceAll(document, msg.json);
        break;
    }
  }

  private applyEdit(document: vscode.TextDocument, path: string, value: unknown): void {
    const manifest = tryParseManifest(document.getText());
    if (!manifest) {
      return;
    }
    setNestedValue(manifest as unknown as Record<string, unknown>, path, value);
    this.writeManifest(document, manifest);
  }

  private addComponent(document: vscode.TextDocument, component: unknown): void {
    const manifest = tryParseManifest(document.getText());
    if (!manifest) {
      return;
    }
    manifest.components.push(component as never);
    this.writeManifest(document, manifest);
  }

  private removeComponent(document: vscode.TextDocument, componentId: string): void {
    const manifest = tryParseManifest(document.getText());
    if (!manifest) {
      return;
    }
    manifest.components = manifest.components.filter((c) => c.id !== componentId);
    this.writeManifest(document, manifest);
  }

  private replaceAll(document: vscode.TextDocument, json: string): void {
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.lineAt(0).range.start,
      document.lineAt(document.lineCount - 1).range.end
    );
    edit.replace(document.uri, fullRange, json);
    vscode.workspace.applyEdit(edit);
  }

  private writeManifest(document: vscode.TextDocument, manifest: ShipwrightManifest): void {
    this.replaceAll(document, JSON.stringify(manifest, null, 2) + "\n");
  }
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

interface EditMessage {
  type: "edit";
  path: string;
  value: unknown;
}
interface AddComponentMessage {
  type: "addComponent";
  component: unknown;
}
interface RemoveComponentMessage {
  type: "removeComponent";
  componentId: string;
}
interface ReplaceAllMessage {
  type: "replaceAll";
  json: string;
}

type WebviewMessage = EditMessage | AddComponentMessage | RemoveComponentMessage | ReplaceAllMessage;
