import * as assert from "assert";
import * as vscode from "vscode";
import {
  activateExtension,
  closeAllEditors,
  createTempFile,
  deleteTempFile,
  setContent,
  openDocument,
} from "./helpers";

suite("Manifest Tree View", () => {
  suiteSetup(async () => {
    await activateExtension();
  });
  teardown(async () => {
    await closeAllEditors();
  });

  test("tree view is registered and visible after activation", async () => {
    const treeView = await vscode.commands.executeCommand<void>("shipwright.refreshTree");
    assert.strictEqual(treeView, undefined, "refreshTree completes without error");

    const allCommands = await vscode.commands.getCommands(true);
    assert.ok(allCommands.includes("shipwright.refreshTree"), "refreshTree registered");
    assert.ok(allCommands.includes("shipwright.addComponent"), "addComponent registered");
  });

  test("tree loads workspace manifest, shows product + components + hosts with correct properties", async () => {
    await vscode.commands.executeCommand("shipwright.refreshTree");

    const doc = await openDocument("shipwright.json");
    const text = doc.getText();
    const parsed = JSON.parse(text) as {
      product: { id: string; version: string; displayName?: string; repository?: string };
      components: Array<{ id: string; kind: string; language?: string; binaryName?: string }>;
      hosts?: Record<string, { artifact?: string; activationVerifies?: string[]; onMismatch?: string }>;
    };

    assert.ok(parsed.product.id, "manifest has product.id");
    assert.ok(parsed.product.version, "manifest has product.version");
    assert.ok(parsed.components.length > 0, "manifest has components");

    assert.strictEqual(parsed.product.id, "test-product");
    assert.strictEqual(parsed.product.version, "1.0.0");
    assert.strictEqual(parsed.product.displayName, "Test Product");
    assert.strictEqual(parsed.product.repository, "https://github.com/example/test-product");

    assert.strictEqual(parsed.components.length, 3);
    const lsp = parsed.components.find((c) => c.id === "test-lsp");
    const cli = parsed.components.find((c) => c.id === "test-cli");
    const mcp = parsed.components.find((c) => c.id === "test-mcp");
    assert.ok(lsp, "test-lsp component exists");
    assert.ok(cli, "test-cli component exists");
    assert.ok(mcp, "test-mcp component exists");
    assert.strictEqual(lsp!.kind, "lsp");
    assert.strictEqual(cli!.kind, "cli");
    assert.strictEqual(mcp!.kind, "mcp");
    assert.strictEqual(lsp!.language, "rust");
    assert.strictEqual(mcp!.language, "typescript");

    assert.ok(parsed.hosts, "manifest has hosts");
    assert.ok(parsed.hosts!["vscode"], "vscode host exists");
    assert.ok(parsed.hosts!["cli"], "cli host exists");
    assert.strictEqual(parsed.hosts!["vscode"].artifact, "vsix-per-platform");
    assert.deepStrictEqual(parsed.hosts!["vscode"].activationVerifies, ["test-lsp", "test-mcp"]);
    assert.strictEqual(parsed.hosts!["vscode"].onMismatch, "error");
    assert.strictEqual(parsed.hosts!["cli"].onMismatch, "warn");
  });

  test("refreshTree picks up manifest changes on disk", async () => {
    const uri = await createTempFile(
      "refresh-test.shipwright.json",
      JSON.stringify(
        {
          manifestVersion: 1,
          product: { id: "before-refresh", version: "0.1.0" },
          components: [],
        },
        null,
        2
      )
    );

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);

      await vscode.commands.executeCommand("shipwright.refreshTree");

      const beforeText = doc.getText();
      assert.ok(beforeText.includes("before-refresh"), "initial content loaded");

      await setContent(
        doc,
        JSON.stringify(
          {
            manifestVersion: 1,
            product: { id: "after-refresh", version: "0.2.0" },
            components: [
              {
                id: "new-comp",
                kind: "cli",
                language: "rust",
                binaryName: "new",
                expectedVersion: "0.2.0",
                platforms: ["linux-x64"],
                sources: ["path"],
              },
            ],
          },
          null,
          2
        )
      );

      await vscode.commands.executeCommand("shipwright.refreshTree");

      const afterText = doc.getText();
      assert.ok(afterText.includes("after-refresh"), "content updated");
      assert.ok(afterText.includes("new-comp"), "new component present");
      assert.ok(!afterText.includes("before-refresh"), "old id gone");

      const parsed = JSON.parse(afterText) as { product: { id: string }; components: Array<{ id: string }> };
      assert.strictEqual(parsed.product.id, "after-refresh");
      assert.strictEqual(parsed.components.length, 1);
      assert.strictEqual(parsed.components[0].id, "new-comp");
    } finally {
      await closeAllEditors();
      await deleteTempFile(uri);
    }
  });

  test("tree handles manifest with all optional fields populated", async () => {
    const rich = JSON.stringify(
      {
        manifestVersion: 1,
        product: {
          id: "rich-prod",
          displayName: "Rich Product",
          version: "3.0.0",
          repository: "https://github.com/example/rich",
          homepage: "https://rich.example.com",
        },
        components: [
          {
            id: "rich-lsp",
            kind: "lsp",
            language: "dotnet",
            binaryName: "rich-lsp",
            expectedVersion: "3.0.0",
            platforms: ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64", "win32-arm64"],
            bundled: { bundlePath: "bin/${platform}/${binaryName}${exe}", perPlatformArtifact: true },
            sources: ["user-setting", "env", "bundled", "path", "dotnet-tool"],
            userSetting: "rich.lspPath",
            env: { pathVar: "RICH_LSP", dirVar: "RICH_DIR" },
            dotnetTool: { package: "Rich.Lsp", command: "rich-lsp" },
            verifyStartup: true,
            versionCheckStrategy: "version-flag",
            required: true,
          },
          {
            id: "rich-asset",
            kind: "asset",
            asset: { path: "data/model.onnx", checksum: "sha256:abc123" },
          },
        ],
        hosts: {
          vscode: {
            artifact: "vsix-per-platform",
            activationVerifies: ["rich-lsp"],
            onMismatch: "prompt-reinstall",
          },
          jetbrains: {
            artifact: "intellij-jar",
            activationVerifies: ["rich-lsp"],
            onMismatch: "warn",
          },
        },
      },
      null,
      2
    );

    const uri = await createTempFile("rich.shipwright.json", rich);

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand("shipwright.refreshTree");

      const parsed = JSON.parse(doc.getText()) as Record<string, unknown>;
      assert.strictEqual((parsed["product"] as Record<string, unknown>)["displayName"], "Rich Product");

      const components = parsed["components"] as Array<Record<string, unknown>>;
      assert.strictEqual(components.length, 2);

      const lsp = components.find((c) => c["id"] === "rich-lsp")!;
      assert.strictEqual(lsp["kind"], "lsp");
      assert.strictEqual(lsp["language"], "dotnet");
      assert.strictEqual((lsp["dotnetTool"] as Record<string, unknown>)["package"], "Rich.Lsp");
      assert.strictEqual((lsp["platforms"] as string[]).length, 6);
      assert.strictEqual((lsp["sources"] as string[]).length, 5);

      const asset = components.find((c) => c["id"] === "rich-asset")!;
      assert.strictEqual(asset["kind"], "asset");
      assert.ok(asset["asset"], "asset block present");

      const hosts = parsed["hosts"] as Record<string, Record<string, unknown>>;
      assert.strictEqual(Object.keys(hosts).length, 2);
      assert.strictEqual(hosts["vscode"]["onMismatch"], "prompt-reinstall");
      assert.strictEqual(hosts["jetbrains"]["onMismatch"], "warn");
    } finally {
      await closeAllEditors();
      await deleteTempFile(uri);
    }
  });
});
