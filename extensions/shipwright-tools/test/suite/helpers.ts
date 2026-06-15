import * as vscode from "vscode";

export const EXTENSION_ID = "nimblesite.shipwright-tools";

export async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  if (!ext) {
    throw new Error(`Extension ${EXTENSION_ID} not found`);
  }
  if (!ext.isActive) {
    await ext.activate();
  }
  return ext;
}

export async function openDocument(relativePath: string): Promise<vscode.TextDocument> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("No workspace folder open");
  }
  const uri = vscode.Uri.joinPath(folder.uri, relativePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
  return doc;
}

export async function createTempFile(relativePath: string, content: string): Promise<vscode.Uri> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("No workspace folder open");
  }
  const uri = vscode.Uri.joinPath(folder.uri, relativePath);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
  return uri;
}

export async function deleteTempFile(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri);
  } catch {
    /* already gone */
  }
}

export async function setContent(doc: vscode.TextDocument, content: string): Promise<void> {
  const editor = await vscode.window.showTextDocument(doc);
  const ok = await editor.edit((eb) => {
    const full = new vscode.Range(doc.lineAt(0).range.start, doc.lineAt(doc.lineCount - 1).range.end);
    eb.replace(full, content);
  });
  if (!ok) {
    throw new Error("editor.edit failed");
  }
}

export function waitForDiagnostics(uri: vscode.Uri, timeout = 5000): Promise<vscode.Diagnostic[]> {
  return new Promise((resolve) => {
    const deadline = setTimeout(() => {
      sub.dispose();
      resolve(vscode.languages.getDiagnostics(uri));
    }, timeout);

    const sub = vscode.languages.onDidChangeDiagnostics((e) => {
      if (e.uris.some((u) => u.toString() === uri.toString())) {
        clearTimeout(deadline);
        sub.dispose();
        setTimeout(() => resolve(vscode.languages.getDiagnostics(uri)), 150);
      }
    });
  });
}

export async function openAndWaitForDiagnostics(
  relativePath: string
): Promise<{ doc: vscode.TextDocument; diags: vscode.Diagnostic[] }> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("No workspace folder open");
  }
  const uri = vscode.Uri.joinPath(folder.uri, relativePath);

  const diagPromise = waitForDiagnostics(uri);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
  const diags = await diagPromise;
  return { doc, diags };
}

export async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}

export function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      manifestVersion: 1,
      product: { id: "test-product", version: "1.0.0" },
      components: [],
      ...overrides,
    },
    null,
    2
  );
}

export function diagMessages(diags: vscode.Diagnostic[]): string[] {
  return diags.map((d) => d.message);
}
