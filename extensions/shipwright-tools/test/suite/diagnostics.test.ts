import * as assert from "assert";
import * as vscode from "vscode";
import {
  activateExtension,
  openDocument,
  setContent,
  waitForDiagnostics,
  closeAllEditors,
  createTempFile,
  deleteTempFile,
  manifest,
  diagMessages,
  openAndWaitForDiagnostics,
} from "./helpers";

suite("Manifest Validation Diagnostics", () => {
  suiteSetup(async () => {
    await activateExtension();
  });
  teardown(async () => {
    await closeAllEditors();
  });

  test("full lifecycle: open valid manifest, corrupt it, fix field-by-field, close", async () => {
    const { doc, diags: initial } = await openAndWaitForDiagnostics("shipwright.json");
    const uri = doc.uri;

    assert.strictEqual(initial.length, 0, `valid manifest: expected 0 diags, got ${diagMessages(initial)}`);

    // corrupt → invalid JSON
    await setContent(doc, "{ absolutely broken json ]]]");
    let diags = await waitForDiagnostics(uri);
    assert.ok(diags.length > 0, "invalid JSON produces diagnostics");
    assert.ok(
      diags.some((d) => /invalid json|manifestversion/i.test(d.message)),
      `expected JSON parse error, got: ${diagMessages(diags)}`
    );
    const shipwrightDiags = diags.filter((d) => d.source === "shipwright");
    assert.ok(shipwrightDiags.length > 0, "at least one diagnostic from shipwright source");

    // valid JSON, missing manifestVersion
    await setContent(doc, JSON.stringify({ product: { id: "x", version: "1.0.0" }, components: [] }));
    diags = await waitForDiagnostics(uri);
    assert.ok(diags.length > 0, "missing manifestVersion produces diagnostics");

    // manifestVersion present but product.id empty
    await setContent(doc, manifest({ product: { id: "", version: "1.0.0" } }));
    diags = await waitForDiagnostics(uri);
    assert.ok(
      diags.some((d) => d.message.includes("Product id")),
      `expected product id error, got: ${diagMessages(diags)}`
    );

    // product.id present but version empty
    await setContent(doc, manifest({ product: { id: "ok", version: "" } }));
    diags = await waitForDiagnostics(uri);
    assert.ok(
      diags.some((d) => d.message.includes("Product version")),
      `expected version error, got: ${diagMessages(diags)}`
    );

    // restore full valid manifest
    const valid = JSON.stringify(
      {
        manifestVersion: 1,
        product: { id: "restored", version: "2.0.0" },
        components: [
          {
            id: "r-lsp",
            kind: "lsp",
            language: "rust",
            binaryName: "r-lsp",
            expectedVersion: "2.0.0",
            platforms: ["linux-x64"],
            sources: ["bundled"],
          },
        ],
      },
      null,
      2
    );
    await setContent(doc, valid);
    diags = await waitForDiagnostics(uri);
    assert.strictEqual(diags.length, 0, `restored valid manifest: expected 0 diags, got ${diagMessages(diags)}`);

    // close → diagnostics cleared
    await closeAllEditors();
    const afterClose = vscode.languages.getDiagnostics(uri);
    assert.strictEqual(afterClose.length, 0, "diagnostics cleared after close");
  });

  test("reports all missing fields for executable components and clears them one by one", async () => {
    const incomplete = manifest({
      components: [{ id: "naked-lsp", kind: "lsp", language: "rust", platforms: ["linux-x64"] }],
    });
    const uri = await createTempFile("incomplete.shipwright.json", incomplete);

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      let diags = await waitForDiagnostics(uri);

      assert.ok(diags.length >= 3, `expected >=3 diags for naked LSP, got ${diags.length}: ${diagMessages(diags)}`);
      assert.ok(
        diags.some((d) => d.message.includes("binaryName")),
        "missing binaryName"
      );
      assert.ok(
        diags.some((d) => d.message.includes("expectedVersion")),
        "missing expectedVersion"
      );
      assert.ok(
        diags.some((d) => d.message.includes("source")),
        "missing sources"
      );
      for (const d of diags) {
        assert.strictEqual(d.severity, vscode.DiagnosticSeverity.Error, `"${d.message}" is Error`);
        assert.strictEqual(d.source, "shipwright");
      }

      // add binaryName
      const withBin = manifest({
        components: [
          {
            id: "naked-lsp",
            kind: "lsp",
            language: "rust",
            binaryName: "naked-lsp",
            platforms: ["linux-x64"],
          },
        ],
      });
      await setContent(doc, withBin);
      diags = await waitForDiagnostics(uri);
      assert.ok(!diags.some((d) => d.message.includes("binaryName")), "binaryName error gone");
      assert.ok(
        diags.some((d) => d.message.includes("expectedVersion")),
        "expectedVersion still there"
      );
      assert.ok(
        diags.some((d) => d.message.includes("source")),
        "sources still there"
      );

      // add expectedVersion
      const withVer = manifest({
        components: [
          {
            id: "naked-lsp",
            kind: "lsp",
            language: "rust",
            binaryName: "naked-lsp",
            expectedVersion: "1.0.0",
            platforms: ["linux-x64"],
          },
        ],
      });
      await setContent(doc, withVer);
      diags = await waitForDiagnostics(uri);
      assert.ok(!diags.some((d) => d.message.includes("expectedVersion")), "version error gone");
      assert.ok(
        diags.some((d) => d.message.includes("source")),
        "sources still there"
      );

      // add sources → all clear
      const complete = manifest({
        components: [
          {
            id: "naked-lsp",
            kind: "lsp",
            language: "rust",
            binaryName: "naked-lsp",
            expectedVersion: "1.0.0",
            platforms: ["linux-x64"],
            sources: ["bundled"],
          },
        ],
      });
      await setContent(doc, complete);
      diags = await waitForDiagnostics(uri);
      assert.strictEqual(diags.length, 0, `fully-fixed LSP: expected 0 diags, got ${diagMessages(diags)}`);
    } finally {
      await closeAllEditors();
      await deleteTempFile(uri);
    }
  });

  test("detects duplicate component ids, clears on dedup", async () => {
    const duped = manifest({
      components: [
        {
          id: "dup",
          kind: "cli",
          language: "rust",
          binaryName: "dup",
          expectedVersion: "1.0.0",
          platforms: ["linux-x64"],
          sources: ["path"],
        },
        {
          id: "dup",
          kind: "lsp",
          language: "rust",
          binaryName: "dup-lsp",
          expectedVersion: "1.0.0",
          platforms: ["linux-x64"],
          sources: ["bundled"],
        },
      ],
    });
    const uri = await createTempFile("dupes.shipwright.json", duped);

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      let diags = await waitForDiagnostics(uri);

      assert.ok(
        diags.some((d) => d.message.includes("Duplicate component id")),
        `expected duplicate error, got: ${diagMessages(diags)}`
      );
      const dupDiag = diags.find((d) => d.message.includes("Duplicate"))!;
      assert.strictEqual(dupDiag.severity, vscode.DiagnosticSeverity.Error);
      assert.strictEqual(dupDiag.source, "shipwright");

      // fix by renaming second component
      const fixed = manifest({
        components: [
          {
            id: "comp-a",
            kind: "cli",
            language: "rust",
            binaryName: "comp-a",
            expectedVersion: "1.0.0",
            platforms: ["linux-x64"],
            sources: ["path"],
          },
          {
            id: "comp-b",
            kind: "lsp",
            language: "rust",
            binaryName: "comp-b",
            expectedVersion: "1.0.0",
            platforms: ["linux-x64"],
            sources: ["bundled"],
          },
        ],
      });
      await setContent(doc, fixed);
      diags = await waitForDiagnostics(uri);
      assert.ok(
        !diags.some((d) => d.message.includes("Duplicate")),
        `deduped: no duplicate diags, got: ${diagMessages(diags)}`
      );
      assert.strictEqual(diags.length, 0, `deduped and complete: 0 diags, got: ${diagMessages(diags)}`);
    } finally {
      await closeAllEditors();
      await deleteTempFile(uri);
    }
  });

  test("validates host activationVerifies references against actual component ids", async () => {
    const badRef = manifest({
      components: [
        {
          id: "real-lsp",
          kind: "lsp",
          language: "rust",
          binaryName: "real-lsp",
          expectedVersion: "1.0.0",
          platforms: ["linux-x64"],
          sources: ["bundled"],
        },
      ],
      hosts: {
        vscode: {
          artifact: "vsix-per-platform",
          activationVerifies: ["real-lsp", "ghost-component"],
          onMismatch: "error",
        },
      },
    });
    const uri = await createTempFile("badhost.shipwright.json", badRef);

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      let diags = await waitForDiagnostics(uri);

      assert.ok(
        diags.some((d) => d.message.includes("ghost-component")),
        `expected unknown component ref, got: ${diagMessages(diags)}`
      );
      assert.ok(
        diags.some((d) => d.message.includes("unknown component")),
        "error message mentions 'unknown component'"
      );
      const refDiag = diags.find((d) => d.message.includes("ghost-component"))!;
      assert.strictEqual(refDiag.severity, vscode.DiagnosticSeverity.Error);

      // fix by adding the missing component
      const fixed = manifest({
        components: [
          {
            id: "real-lsp",
            kind: "lsp",
            language: "rust",
            binaryName: "real-lsp",
            expectedVersion: "1.0.0",
            platforms: ["linux-x64"],
            sources: ["bundled"],
          },
          {
            id: "ghost-component",
            kind: "mcp",
            language: "rust",
            binaryName: "ghost",
            expectedVersion: "1.0.0",
            platforms: ["linux-x64"],
            sources: ["path"],
          },
        ],
        hosts: {
          vscode: {
            artifact: "vsix-per-platform",
            activationVerifies: ["real-lsp", "ghost-component"],
            onMismatch: "error",
          },
        },
      });
      await setContent(doc, fixed);
      diags = await waitForDiagnostics(uri);
      assert.ok(
        !diags.some((d) => d.message.includes("ghost-component")),
        `ref resolved: no ghost error, got: ${diagMessages(diags)}`
      );
      assert.strictEqual(diags.length, 0, `all clean after fix, got: ${diagMessages(diags)}`);

      // introduce TWO bad refs at once
      const twoBad = manifest({
        components: [
          {
            id: "only-real",
            kind: "cli",
            language: "rust",
            binaryName: "only",
            expectedVersion: "1.0.0",
            platforms: ["linux-x64"],
            sources: ["path"],
          },
        ],
        hosts: {
          vscode: { activationVerifies: ["phantom-a", "phantom-b"] },
          jetbrains: { activationVerifies: ["phantom-c"] },
        },
      });
      await setContent(doc, twoBad);
      diags = await waitForDiagnostics(uri);
      const refErrors = diags.filter((d) => d.message.includes("unknown component"));
      assert.ok(refErrors.length >= 3, `expected >=3 ref errors, got ${refErrors.length}: ${diagMessages(refErrors)}`);
      assert.ok(diags.some((d) => d.message.includes("phantom-a")));
      assert.ok(diags.some((d) => d.message.includes("phantom-b")));
      assert.ok(diags.some((d) => d.message.includes("phantom-c")));
    } finally {
      await closeAllEditors();
      await deleteTempFile(uri);
    }
  });

  test("warns on unknown platform identifiers and clears on fix", async () => {
    const badPlatform = manifest({
      components: [
        {
          id: "plat-test",
          kind: "cli",
          language: "rust",
          binaryName: "plat",
          expectedVersion: "1.0.0",
          platforms: ["linux-x64", "commodore-64"],
          sources: ["path"],
        },
      ],
    });
    const uri = await createTempFile("badplat.shipwright.json", badPlatform);

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      let diags = await waitForDiagnostics(uri);

      const platWarns = diags.filter((d) => d.message.includes("commodore-64"));
      assert.ok(platWarns.length > 0, `expected platform warning, got: ${diagMessages(diags)}`);
      assert.strictEqual(
        platWarns[0].severity,
        vscode.DiagnosticSeverity.Warning,
        "unknown platform is a Warning not Error"
      );
      assert.ok(platWarns[0].message.includes("Unknown platform"));

      // fix platform
      const fixedPlat = manifest({
        components: [
          {
            id: "plat-test",
            kind: "cli",
            language: "rust",
            binaryName: "plat",
            expectedVersion: "1.0.0",
            platforms: ["linux-x64", "darwin-arm64"],
            sources: ["path"],
          },
        ],
      });
      await setContent(doc, fixedPlat);
      diags = await waitForDiagnostics(uri);
      assert.ok(
        !diags.some((d) => d.message.includes("Unknown platform")),
        `platform warning cleared, got: ${diagMessages(diags)}`
      );
      assert.strictEqual(diags.length, 0);
    } finally {
      await closeAllEditors();
      await deleteTempFile(uri);
    }
  });

  test("warns when bundled config present but 'bundled' missing from sources", async () => {
    const mismatch = manifest({
      components: [
        {
          id: "bundle-test",
          kind: "lsp",
          language: "rust",
          binaryName: "bundle-test",
          expectedVersion: "1.0.0",
          platforms: ["linux-x64"],
          bundled: { bundlePath: "bin/${platform}/${binaryName}", perPlatformArtifact: true },
          sources: ["path", "env"],
        },
      ],
    });
    const uri = await createTempFile("bundlewarn.shipwright.json", mismatch);

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      let diags = await waitForDiagnostics(uri);

      const bundleWarn = diags.filter(
        (d) => d.message.includes("bundled") && d.message.includes("missing from sources")
      );
      assert.ok(bundleWarn.length > 0, `expected bundled-source mismatch warning, got: ${diagMessages(diags)}`);
      assert.strictEqual(bundleWarn[0].severity, vscode.DiagnosticSeverity.Warning);

      // fix by adding "bundled" to sources
      const fixed = manifest({
        components: [
          {
            id: "bundle-test",
            kind: "lsp",
            language: "rust",
            binaryName: "bundle-test",
            expectedVersion: "1.0.0",
            platforms: ["linux-x64"],
            bundled: { bundlePath: "bin/${platform}/${binaryName}", perPlatformArtifact: true },
            sources: ["path", "env", "bundled"],
          },
        ],
      });
      await setContent(doc, fixed);
      diags = await waitForDiagnostics(uri);
      assert.strictEqual(diags.length, 0, `bundled warning cleared, got: ${diagMessages(diags)}`);
    } finally {
      await closeAllEditors();
      await deleteTempFile(uri);
    }
  });

  test("validates all component kinds: executables need fields, extensions and assets do not", async () => {
    const execKinds = ["cli", "lsp", "mcp", "sidecar", "dap", "tool"];
    const nonExecKinds = ["extension-vscode", "extension-jetbrains", "extension-zed"];

    // executable kinds WITHOUT required fields → errors
    for (const kind of execKinds) {
      const m = manifest({ components: [{ id: `bare-${kind}`, kind }] });
      const uri = await createTempFile(`kind-${kind}.shipwright.json`, m);
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
        const diags = await waitForDiagnostics(uri);
        assert.ok(
          diags.some((d) => d.message.includes("binaryName")),
          `${kind}: requires binaryName`
        );
        assert.ok(
          diags.some((d) => d.message.includes("expectedVersion")),
          `${kind}: requires expectedVersion`
        );
        assert.ok(
          diags.some((d) => d.message.includes("source")),
          `${kind}: requires sources`
        );
      } finally {
        await closeAllEditors();
        await deleteTempFile(uri);
      }
    }

    // non-executable kinds without those fields → no errors
    for (const kind of nonExecKinds) {
      const m = manifest({
        components: [{ id: `ext-${kind}`, kind, language: "typescript" }],
      });
      const uri = await createTempFile(`kind-${kind}.shipwright.json`, m);
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
        const diags = await waitForDiagnostics(uri);
        assert.ok(!diags.some((d) => d.message.includes("binaryName")), `${kind}: no binaryName requirement`);
        assert.ok(!diags.some((d) => d.message.includes("expectedVersion")), `${kind}: no expectedVersion requirement`);
      } finally {
        await closeAllEditors();
        await deleteTempFile(uri);
      }
    }
  });

  test("asset component without asset block produces error", async () => {
    const noAsset = manifest({
      components: [{ id: "my-asset", kind: "asset" }],
    });
    const uri = await createTempFile("asset-err.shipwright.json", noAsset);

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      const diags = await waitForDiagnostics(uri);

      assert.ok(
        diags.some((d) => d.message.includes("asset") && d.message.includes("requires")),
        `expected asset-block error, got: ${diagMessages(diags)}`
      );

      // add asset block → clears
      const withAsset = manifest({
        components: [{ id: "my-asset", kind: "asset", asset: { path: "data/model.bin" } }],
      });
      await setContent(doc, withAsset);
      const fixed = await waitForDiagnostics(uri);
      assert.strictEqual(fixed.length, 0, `asset with block: 0 diags, got: ${diagMessages(fixed)}`);
    } finally {
      await closeAllEditors();
      await deleteTempFile(uri);
    }
  });

  test("multiple manifests open simultaneously get independent diagnostics", async () => {
    const good = manifest({
      components: [
        {
          id: "g",
          kind: "cli",
          language: "rust",
          binaryName: "g",
          expectedVersion: "1.0.0",
          platforms: ["linux-x64"],
          sources: ["path"],
        },
      ],
    });
    const bad = manifest({
      components: [{ id: "b", kind: "lsp", language: "rust" }],
    });

    const uriGood = await createTempFile("multi-good.shipwright.json", good);
    const uriBad = await createTempFile("multi-bad.shipwright.json", bad);

    try {
      const docGood = await vscode.workspace.openTextDocument(uriGood);
      await vscode.window.showTextDocument(docGood);
      await waitForDiagnostics(uriGood);

      const docBad = await vscode.workspace.openTextDocument(uriBad);
      await vscode.window.showTextDocument(docBad);
      await waitForDiagnostics(uriBad);

      const goodDiags = vscode.languages.getDiagnostics(uriGood);
      const badDiags = vscode.languages.getDiagnostics(uriBad);

      assert.strictEqual(goodDiags.length, 0, `good manifest clean, got: ${diagMessages(goodDiags)}`);
      assert.ok(badDiags.length >= 3, `bad manifest has errors, got: ${diagMessages(badDiags)}`);

      // fix the bad one → both clean
      await setContent(docBad, good);
      await waitForDiagnostics(uriBad);

      assert.strictEqual(vscode.languages.getDiagnostics(uriGood).length, 0);
      assert.strictEqual(vscode.languages.getDiagnostics(uriBad).length, 0, `fixed bad manifest: 0 diags`);
    } finally {
      await closeAllEditors();
      await deleteTempFile(uriGood);
      await deleteTempFile(uriBad);
    }
  });
});
