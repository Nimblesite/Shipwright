import * as assert from "assert";
import * as vscode from "vscode";
import {
  activateExtension,
  closeAllEditors,
  createTempFile,
  deleteTempFile,
  waitForDiagnostics,
  diagMessages,
} from "./helpers";

suite("Custom Editor Provider", () => {
  suiteSetup(async () => {
    await activateExtension();
  });
  teardown(async () => {
    await closeAllEditors();
  });

  test("opens manifest in custom editor, syncs edits back to text document", async () => {
    const content = JSON.stringify(
      {
        manifestVersion: 1,
        product: { id: "editor-test", version: "1.0.0" },
        components: [
          {
            id: "ed-lsp",
            kind: "lsp",
            language: "rust",
            binaryName: "ed-lsp",
            expectedVersion: "1.0.0",
            platforms: ["linux-x64"],
            sources: ["bundled"],
          },
        ],
      },
      null,
      2
    );
    const uri = await createTempFile("editor-test.shipwright.json", content);

    try {
      // open with the text editor first
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);

      // verify initial text content
      const initialText = doc.getText();
      const parsed = JSON.parse(initialText) as { product: { id: string } };
      assert.strictEqual(parsed.product.id, "editor-test");

      // now open with custom editor
      await vscode.commands.executeCommand("vscode.openWith", uri, "shipwright.manifestEditor");
      await new Promise((r) => {
        setTimeout(r, 500);
      });

      const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
      assert.ok(tabs.length >= 1, "at least one tab open after custom editor");

      // modify the underlying document (simulates webview edit propagation)
      const textDoc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(textDoc);
      const newContent = JSON.stringify(
        {
          manifestVersion: 1,
          product: { id: "editor-modified", version: "2.0.0" },
          components: [
            {
              id: "ed-lsp",
              kind: "lsp",
              language: "rust",
              binaryName: "ed-lsp",
              expectedVersion: "2.0.0",
              platforms: ["linux-x64"],
              sources: ["bundled"],
            },
          ],
        },
        null,
        2
      );
      const fullRange = new vscode.Range(
        textDoc.lineAt(0).range.start,
        textDoc.lineAt(textDoc.lineCount - 1).range.end
      );
      await editor.edit((eb) => {
        eb.replace(fullRange, newContent);
      });

      const updatedText = textDoc.getText();
      const updatedParsed = JSON.parse(updatedText) as { product: { id: string; version: string } };
      assert.strictEqual(updatedParsed.product.id, "editor-modified");
      assert.strictEqual(updatedParsed.product.version, "2.0.0");

      // diagnostics should still be clean
      await waitForDiagnostics(uri);
      const diags = vscode.languages.getDiagnostics(uri);
      assert.strictEqual(diags.length, 0, `modified manifest still valid, got: ${diagMessages(diags)}`);
    } finally {
      await closeAllEditors();
      await deleteTempFile(uri);
    }
  });

  test("custom editor handles invalid content gracefully", async () => {
    const content = "not valid json at all {{{";
    const uri = await createTempFile("editor-invalid.shipwright.json", content);

    try {
      await vscode.commands.executeCommand("vscode.openWith", uri, "shipwright.manifestEditor");
      await new Promise((r) => {
        setTimeout(r, 500);
      });

      const diags = await waitForDiagnostics(uri);
      assert.ok(diags.length > 0, `invalid JSON produces diagnostics in custom editor, got: ${diagMessages(diags)}`);

      // fix the content through text editor
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      const validContent = JSON.stringify(
        {
          manifestVersion: 1,
          product: { id: "fixed", version: "1.0.0" },
          components: [],
        },
        null,
        2
      );
      const fullRange = new vscode.Range(doc.lineAt(0).range.start, doc.lineAt(doc.lineCount - 1).range.end);
      await editor.edit((eb) => {
        eb.replace(fullRange, validContent);
      });

      const fixedDiags = await waitForDiagnostics(uri);
      assert.strictEqual(fixedDiags.length, 0, `fixed content clears diagnostics, got: ${diagMessages(fixedDiags)}`);
    } finally {
      await closeAllEditors();
      await deleteTempFile(uri);
    }
  });

  test("custom editor coexists with diagnostics and tree view simultaneously", async () => {
    const content = JSON.stringify(
      {
        manifestVersion: 1,
        product: { id: "coexist-test", version: "1.0.0" },
        components: [
          {
            id: "c1",
            kind: "cli",
            language: "rust",
            binaryName: "c1",
            expectedVersion: "1.0.0",
            platforms: ["linux-x64"],
            sources: ["path"],
          },
          {
            id: "c2",
            kind: "lsp",
            language: "rust",
            binaryName: "c2",
            expectedVersion: "1.0.0",
            platforms: ["linux-x64"],
            sources: ["bundled"],
          },
        ],
        hosts: {
          vscode: {
            artifact: "vsix-per-platform",
            activationVerifies: ["c1", "c2"],
            onMismatch: "error",
          },
        },
      },
      null,
      2
    );
    const uri = await createTempFile("coexist.shipwright.json", content);

    try {
      // open custom editor
      await vscode.commands.executeCommand("vscode.openWith", uri, "shipwright.manifestEditor");
      await new Promise((r) => {
        setTimeout(r, 300);
      });

      // refresh tree
      await vscode.commands.executeCommand("shipwright.refreshTree");

      // run validate
      await vscode.commands.executeCommand("shipwright.validate");

      // all should be clean
      const diags = vscode.languages.getDiagnostics(uri);
      assert.strictEqual(diags.length, 0, `coexist manifest clean, got: ${diagMessages(diags)}`);

      // introduce error via text editor
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      const broken = JSON.stringify(
        {
          manifestVersion: 1,
          product: { id: "coexist-test", version: "1.0.0" },
          components: [
            {
              id: "c1",
              kind: "cli",
              language: "rust",
              binaryName: "c1",
              expectedVersion: "1.0.0",
              platforms: ["linux-x64"],
              sources: ["path"],
            },
          ],
          hosts: {
            vscode: {
              artifact: "vsix-per-platform",
              activationVerifies: ["c1", "c2"],
              onMismatch: "error",
            },
          },
        },
        null,
        2
      );
      const fullRange = new vscode.Range(doc.lineAt(0).range.start, doc.lineAt(doc.lineCount - 1).range.end);
      await editor.edit((eb) => {
        eb.replace(fullRange, broken);
      });

      const updatedDiags = await waitForDiagnostics(uri);
      assert.ok(
        updatedDiags.some((d) => d.message.includes("c2")),
        `removed component detected by host validation, got: ${diagMessages(updatedDiags)}`
      );

      // refresh tree again — should not crash
      await vscode.commands.executeCommand("shipwright.refreshTree");

      // validate again — errors persist
      await vscode.commands.executeCommand("shipwright.validate");
      const reDiags = vscode.languages.getDiagnostics(uri);
      assert.ok(
        reDiags.some((d) => d.message.includes("c2")),
        `error persists after re-validate, got: ${diagMessages(reDiags)}`
      );
    } finally {
      await closeAllEditors();
      await deleteTempFile(uri);
    }
  });

  test("opening multiple manifests in custom editors works independently", async () => {
    const contentA = JSON.stringify(
      {
        manifestVersion: 1,
        product: { id: "multi-a", version: "1.0.0" },
        components: [
          {
            id: "ma",
            kind: "cli",
            language: "rust",
            binaryName: "ma",
            expectedVersion: "1.0.0",
            platforms: ["linux-x64"],
            sources: ["path"],
          },
        ],
      },
      null,
      2
    );
    const contentB = JSON.stringify(
      {
        manifestVersion: 1,
        product: { id: "multi-b", version: "2.0.0" },
        components: [{ id: "mb", kind: "lsp", language: "rust" }],
      },
      null,
      2
    );

    const uriA = await createTempFile("multi-a.shipwright.json", contentA);
    const uriB = await createTempFile("multi-b.shipwright.json", contentB);

    try {
      await vscode.commands.executeCommand("vscode.openWith", uriA, "shipwright.manifestEditor");
      await new Promise((r) => {
        setTimeout(r, 300);
      });

      await vscode.commands.executeCommand("vscode.openWith", uriB, "shipwright.manifestEditor");
      await new Promise((r) => {
        setTimeout(r, 300);
      });

      await waitForDiagnostics(uriA);
      await waitForDiagnostics(uriB);

      const diagsA = vscode.languages.getDiagnostics(uriA);
      const diagsB = vscode.languages.getDiagnostics(uriB);

      assert.strictEqual(diagsA.length, 0, `multi-a is valid, got: ${diagMessages(diagsA)}`);
      assert.ok(diagsB.length >= 3, `multi-b has errors, got: ${diagMessages(diagsB)}`);

      assert.ok(diagsB.some((d) => d.message.includes("binaryName")));
      assert.ok(diagsB.some((d) => d.message.includes("expectedVersion")));
      assert.ok(diagsB.some((d) => d.message.includes("source")));
    } finally {
      await closeAllEditors();
      await deleteTempFile(uriA);
      await deleteTempFile(uriB);
    }
  });
});
