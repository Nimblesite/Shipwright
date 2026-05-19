import { describe, expect, it } from "vitest";
import { parseVersionOutput, probeBinaryVersion, type ExecFile } from "../src/index.js";

describe("probeBinaryVersion", () => {
  it("runs --version with the standard timeout and parses plain output", async () => {
    const calls: Array<{ args: readonly string[]; timeout?: number }> = [];
    const execFile: ExecFile = (_file, args, options, callback) => {
      const call: { args: readonly string[]; timeout?: number } = { args };
      if (options.timeout !== undefined) call.timeout = options.timeout;
      calls.push(call);
      callback(null, "deslop-lsp 0.1.0\n", "");
    };

    await expect(probeBinaryVersion("/extension/bin/deslop-lsp", { execFile })).resolves.toEqual({
      name: "deslop-lsp",
      version: "0.1.0"
    });
    expect(calls).toEqual([{ args: ["--version"], timeout: 1500 }]);
  });

  it("returns undefined when execFile fails", async () => {
    const execFile: ExecFile = (_file, _args, _options, callback) => {
      callback(Object.assign(new Error("not found"), { code: "ENOENT" }), "", "");
    };

    await expect(probeBinaryVersion("/missing/deslop-lsp", { execFile })).resolves.toBeUndefined();
  });
});

describe("parseVersionOutput", () => {
  it("parses the first stdout line", () => {
    expect(parseVersionOutput("forge-sidecar-csharp 1.2.3\nignored text\n")).toEqual({
      name: "forge-sidecar-csharp",
      version: "1.2.3"
    });
  });

  it("parses JSON version output when a binary uses JSON by default", () => {
    expect(parseVersionOutput('{"schemaVersion":1,"componentId":"tmc-server","version":"0.5.0"}')).toEqual({
      name: "tmc-server",
      version: "0.5.0"
    });
  });

  it("rejects unparsable output", () => {
    expect(parseVersionOutput("starting real server")).toBeUndefined();
  });
});
