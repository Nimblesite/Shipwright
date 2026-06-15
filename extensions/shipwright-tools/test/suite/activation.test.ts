import * as assert from "assert";
import * as vscode from "vscode";
import { EXTENSION_ID, activateExtension } from "./helpers";

suite("Extension Activation", () => {
  test("activates in a workspace with shipwright.json and registers all commands and providers", async () => {
    const ext = await activateExtension();

    assert.ok(ext, "extension instance exists");
    assert.strictEqual(ext.isActive, true, "extension is active");
    assert.strictEqual(ext.id, EXTENSION_ID);

    const allCommands = await vscode.commands.getCommands(true);
    const ours = allCommands.filter((c) => c.startsWith("shipwright."));

    const expected = [
      "shipwright.openVisualEditor",
      "shipwright.scaffold",
      "shipwright.validate",
      "shipwright.refreshTree",
      "shipwright.addComponent",
      "shipwright.platformMatrix",
    ];
    for (const cmd of expected) {
      assert.ok(ours.includes(cmd), `command ${cmd} should be registered`);
    }
    assert.ok(ours.length >= expected.length, `at least ${expected.length} shipwright commands, got ${ours.length}`);

    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, "workspace has folders");

    const manifests = await vscode.workspace.findFiles("**/shipwright.json", "**/node_modules/**", 5);
    assert.ok(manifests.length > 0, "workspace contains shipwright.json");
  });

  test("does not register duplicate commands on repeated activation calls", async () => {
    const ext = await activateExtension();
    assert.strictEqual(ext.isActive, true);

    const before = (await vscode.commands.getCommands(true)).filter((c) => c.startsWith("shipwright."));

    await ext.activate();

    const after = (await vscode.commands.getCommands(true)).filter((c) => c.startsWith("shipwright."));

    assert.strictEqual(before.length, after.length, "command count unchanged after second activate");
    for (const cmd of before) {
      assert.ok(after.includes(cmd), `${cmd} still present after re-activate`);
    }
  });
});
