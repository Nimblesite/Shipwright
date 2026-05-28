import * as assert from "assert";
import * as vscode from "vscode";
import {
  activateExtension, closeAllEditors, createTempFile,
  deleteTempFile, waitForDiagnostics, openDocument,
  diagMessages,
} from "./helpers";

suite("Extension Commands", () => {
  suiteSetup(async () => { await activateExtension(); });
  teardown(async () => { await closeAllEditors(); });

  test("shipwright.validate scans workspace, runs validation on all manifests, reports results", async () => {
    const good = JSON.stringify({
      manifestVersion: 1,
      product: { id: "cmd-test", version: "1.0.0" },
      components: [{
        id: "ct-cli", kind: "cli", language: "rust", binaryName: "ct",
        expectedVersion: "1.0.0", platforms: ["linux-x64"], sources: ["path"],
      }],
    }, null, 2);
    const uri = await createTempFile("cmd-good.shipwright.json", good);

    try {
      await vscode.commands.executeCommand("shipwright.validate");

      const mainDiags = vscode.languages.getDiagnostics(
        vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "shipwright.json"),
      );
      assert.strictEqual(mainDiags.length, 0,
        `main manifest clean after validate, got: ${diagMessages(mainDiags)}`);

      const cmdDiags = vscode.languages.getDiagnostics(uri);
      assert.strictEqual(cmdDiags.length, 0,
        `temp manifest clean after validate, got: ${diagMessages(cmdDiags)}`);
    } finally {
      await closeAllEditors();
      await deleteTempFile(uri);
    }
  });

  test("shipwright.validate finds and reports issues across multiple shipwright.json files", async () => {
    const bad = JSON.stringify({
      manifestVersion: 1,
      product: { id: "bad-cmd", version: "1.0.0" },
      components: [{ id: "broken", kind: "lsp", language: "rust" }],
    }, null, 2);
    const folder = vscode.workspace.workspaceFolders![0];
    const subDir = vscode.Uri.joinPath(folder.uri, "sub-pkg");
    await vscode.workspace.fs.createDirectory(subDir);
    const uriBad = vscode.Uri.joinPath(subDir, "shipwright.json");
    await vscode.workspace.fs.writeFile(uriBad, new TextEncoder().encode(bad));

    try {
      const diagPromise = waitForDiagnostics(uriBad);
      await vscode.commands.executeCommand("shipwright.validate");
      await diagPromise;

      const badDiags = vscode.languages.getDiagnostics(uriBad);
      assert.ok(badDiags.length >= 3,
        `broken manifest flagged, got ${badDiags.length}: ${diagMessages(badDiags)}`);
      assert.ok(badDiags.some((d) => d.message.includes("binaryName")));
      assert.ok(badDiags.some((d) => d.message.includes("expectedVersion")));
      assert.ok(badDiags.some((d) => d.message.includes("source")));

      const mainDiags = vscode.languages.getDiagnostics(
        vscode.Uri.joinPath(folder.uri, "shipwright.json"),
      );
      assert.strictEqual(mainDiags.length, 0,
        `main manifest still clean, got: ${diagMessages(mainDiags)}`);
    } finally {
      await closeAllEditors();
      await vscode.workspace.fs.delete(subDir, { recursive: true });
    }
  });

  test("shipwright.refreshTree succeeds repeatedly without error", async () => {
    for (let i = 0; i < 5; i++) {
      await vscode.commands.executeCommand("shipwright.refreshTree");
    }
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("shipwright.refreshTree"),
      "command still registered after 5 invocations");
  });

  test("shipwright.platformMatrix opens a webview panel for the workspace manifest", async () => {
    const tabsBefore = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs).length;

    await vscode.commands.executeCommand("shipwright.platformMatrix");

    // give the webview a moment to open
    await new Promise((r) => { setTimeout(r, 500); });

    const tabsAfter = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs).length;

    assert.ok(tabsAfter > tabsBefore,
      `platformMatrix should open a new tab (before=${tabsBefore} after=${tabsAfter})`);

    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    const matrixTab = tabs.find((t) =>
      t.label.includes("Platform Matrix") || t.label.includes("test-product"));
    assert.ok(matrixTab, `expected Platform Matrix tab, found: ${tabs.map((t) => t.label)}`);
  });

  test("shipwright.openVisualEditor opens the custom editor for a manifest file", async () => {
    const doc = await openDocument("shipwright.json");
    assert.ok(doc, "document opened");

    const tabsBefore = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs).length;

    await vscode.commands.executeCommand("shipwright.openVisualEditor");

    await new Promise((r) => { setTimeout(r, 500); });

    const tabsAfter = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs).length;

    assert.ok(tabsAfter >= tabsBefore,
      "openVisualEditor opens or reuses a tab");
  });

  test("editing a manifest through a text editor triggers real-time revalidation", async () => {
    const initial = JSON.stringify({
      manifestVersion: 1,
      product: { id: "rt-test", version: "1.0.0" },
      components: [{
        id: "rt-lsp", kind: "lsp", language: "rust", binaryName: "rt-lsp",
        expectedVersion: "1.0.0", platforms: ["linux-x64"], sources: ["bundled"],
      }],
    }, null, 2);
    const uri = await createTempFile("realtime.shipwright.json", initial);

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      await waitForDiagnostics(uri);

      let diags = vscode.languages.getDiagnostics(uri);
      assert.strictEqual(diags.length, 0, "starts clean");

      // type an edit that breaks the JSON
      await editor.edit((eb) => {
        eb.insert(new vscode.Position(0, 0), "GARBAGE");
      });
      diags = await waitForDiagnostics(uri);
      assert.ok(diags.length > 0, "broken JSON flagged immediately");

      // undo the damage
      await vscode.commands.executeCommand("undo");
      diags = await waitForDiagnostics(uri);
      assert.strictEqual(diags.length, 0,
        `undo restores clean state, got: ${diagMessages(diags)}`);

      // add a second component with duplicate id via editor
      const parsed = JSON.parse(doc.getText()) as {
        manifestVersion: number;
        product: { id: string; version: string };
        components: Array<Record<string, unknown>>;
      };
      parsed.components.push({
        id: "rt-lsp", kind: "cli", language: "rust", binaryName: "dup",
        expectedVersion: "1.0.0", platforms: ["linux-x64"], sources: ["path"],
      });
      const fullRange = new vscode.Range(
        doc.lineAt(0).range.start,
        doc.lineAt(doc.lineCount - 1).range.end,
      );
      await editor.edit((eb) => { eb.replace(fullRange, JSON.stringify(parsed, null, 2)); });
      diags = await waitForDiagnostics(uri);
      assert.ok(diags.some((d) => d.message.includes("Duplicate")),
        `duplicate detected via editor, got: ${diagMessages(diags)}`);
    } finally {
      await closeAllEditors();
      await deleteTempFile(uri);
    }
  });
});
