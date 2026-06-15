import * as vscode from "vscode";
import type { ShipwrightManifest, Component } from "../types";
import { tryParseManifest, ALL_PLATFORMS } from "../types";

const DIAG_SOURCE = "shipwright";

export function registerValidation(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel
): vscode.Disposable[] {
  const collection = vscode.languages.createDiagnosticCollection(DIAG_SOURCE);

  const validateOpen = (doc: vscode.TextDocument): void => {
    if (!isManifest(doc)) {
      return;
    }
    collection.set(doc.uri, validate(doc));
  };

  for (const doc of vscode.workspace.textDocuments) {
    validateOpen(doc);
  }

  const onOpen = vscode.workspace.onDidOpenTextDocument(validateOpen);
  const onChange = vscode.workspace.onDidChangeTextDocument((e) => {
    if (isManifest(e.document)) {
      collection.set(e.document.uri, validate(e.document));
    }
  });
  const onClose = vscode.workspace.onDidCloseTextDocument((doc) => {
    collection.delete(doc.uri);
  });

  const cmd = vscode.commands.registerCommand("shipwright.validate", async () => {
    const files = await vscode.workspace.findFiles("**/shipwright.json", "**/node_modules/**", 10);
    let totalIssues = 0;
    for (const uri of files) {
      const doc = await vscode.workspace.openTextDocument(uri);
      const diags = validate(doc);
      collection.set(uri, diags);
      totalIssues += diags.length;
    }
    const msg =
      totalIssues === 0
        ? `Validated ${files.length} manifest(s) — no issues`
        : `Found ${totalIssues} issue(s) across ${files.length} manifest(s)`;
    output.info(msg);
    vscode.window.showInformationMessage(msg);
  });

  return [collection, onOpen, onChange, onClose, cmd];
}

function isManifest(doc: vscode.TextDocument): boolean {
  return doc.fileName.endsWith("shipwright.json") || /fixtures[\\/]manifests[\\/].*\.json$/.test(doc.fileName);
}

function validate(doc: vscode.TextDocument): vscode.Diagnostic[] {
  const text = doc.getText();
  const manifest = tryParseManifest(text);
  if (!manifest) {
    return [makeDiag(doc, 0, "Invalid JSON or missing manifestVersion", vscode.DiagnosticSeverity.Error)];
  }

  const diags: vscode.Diagnostic[] = [];
  validateProduct(doc, text, manifest, diags);
  validateComponents(doc, text, manifest, diags);
  validateHosts(doc, text, manifest, diags);
  return diags;
}

function validateProduct(
  doc: vscode.TextDocument,
  text: string,
  manifest: ShipwrightManifest,
  diags: vscode.Diagnostic[]
): void {
  if (!manifest.product.id) {
    diags.push(makeDiag(doc, findOffset(text, '"product"'), "Product id is required", vscode.DiagnosticSeverity.Error));
  }
  if (!manifest.product.version) {
    diags.push(
      makeDiag(doc, findOffset(text, '"product"'), "Product version is required", vscode.DiagnosticSeverity.Error)
    );
  }
}

function validateComponents(
  doc: vscode.TextDocument,
  text: string,
  manifest: ShipwrightManifest,
  diags: vscode.Diagnostic[]
): void {
  const ids = new Set<string>();
  for (const comp of manifest.components) {
    const offset = findComponentOffset(text, comp.id);
    if (ids.has(comp.id)) {
      diags.push(makeDiag(doc, offset, `Duplicate component id: ${comp.id}`, vscode.DiagnosticSeverity.Error));
    }
    ids.add(comp.id);
    validateSingleComponent(doc, text, comp, offset, diags);
  }
}

function validateSingleComponent(
  doc: vscode.TextDocument,
  _text: string,
  comp: Component,
  offset: number,
  diags: vscode.Diagnostic[]
): void {
  const isExecutable = ["cli", "lsp", "mcp", "sidecar", "dap", "tool"].includes(comp.kind);
  if (isExecutable && !comp.binaryName) {
    diags.push(
      makeDiag(
        doc,
        offset,
        `Component "${comp.id}" (${comp.kind}) requires binaryName`,
        vscode.DiagnosticSeverity.Error
      )
    );
  }
  if (isExecutable && !comp.expectedVersion) {
    diags.push(
      makeDiag(
        doc,
        offset,
        `Component "${comp.id}" (${comp.kind}) requires expectedVersion`,
        vscode.DiagnosticSeverity.Error
      )
    );
  }
  if (isExecutable && (!comp.sources || comp.sources.length === 0)) {
    diags.push(
      makeDiag(
        doc,
        offset,
        `Component "${comp.id}" (${comp.kind}) requires at least one source`,
        vscode.DiagnosticSeverity.Error
      )
    );
  }
  if (comp.kind === "asset" && !comp.asset) {
    diags.push(
      makeDiag(doc, offset, `Component "${comp.id}" (asset) requires an asset block`, vscode.DiagnosticSeverity.Error)
    );
  }
  if (comp.platforms) {
    for (const p of comp.platforms) {
      if (!ALL_PLATFORMS.includes(p)) {
        diags.push(
          makeDiag(doc, offset, `Unknown platform "${p}" in component "${comp.id}"`, vscode.DiagnosticSeverity.Warning)
        );
      }
    }
  }
  if (comp.bundled && comp.sources && !comp.sources.includes("bundled")) {
    diags.push(
      makeDiag(
        doc,
        offset,
        `Component "${comp.id}" has bundled config but "bundled" is missing from sources`,
        vscode.DiagnosticSeverity.Warning
      )
    );
  }
}

function validateHosts(
  doc: vscode.TextDocument,
  text: string,
  manifest: ShipwrightManifest,
  diags: vscode.Diagnostic[]
): void {
  if (!manifest.hosts) {
    return;
  }
  const compIds = new Set(manifest.components.map((c) => c.id));
  for (const [hostName, policy] of Object.entries(manifest.hosts)) {
    if (!policy.activationVerifies) {
      continue;
    }
    for (const ref of policy.activationVerifies) {
      if (!compIds.has(ref)) {
        const offset = findOffset(text, `"${hostName}"`);
        diags.push(
          makeDiag(
            doc,
            offset,
            `Host "${hostName}" references unknown component "${ref}"`,
            vscode.DiagnosticSeverity.Error
          )
        );
      }
    }
  }
}

function makeDiag(
  doc: vscode.TextDocument,
  offset: number,
  message: string,
  severity: vscode.DiagnosticSeverity
): vscode.Diagnostic {
  const pos = doc.positionAt(offset);
  const range = doc.getWordRangeAtPosition(pos) ?? new vscode.Range(pos, pos.translate(0, 20));
  const diag = new vscode.Diagnostic(range, message, severity);
  diag.source = DIAG_SOURCE;
  return diag;
}

function findOffset(text: string, needle: string): number {
  const idx = text.indexOf(needle);
  return idx >= 0 ? idx : 0;
}

function findComponentOffset(text: string, id: string): number {
  const pattern = `"id":\\s*"${id}"`;
  const match = new RegExp(pattern).exec(text);
  return match ? match.index : 0;
}
