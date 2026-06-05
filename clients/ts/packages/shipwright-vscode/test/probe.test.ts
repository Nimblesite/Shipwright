import { describe, expect, it } from "vitest";
import { parseVersionOutput, probeBinaryVersion, probeBinaryVersionResult, type ExecFile } from "../src/index.js";

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
    expect(calls).toEqual([{ args: ["--version"], timeout: 10000 }]);
  });

  it("returns undefined when execFile fails", async () => {
    const execFile: ExecFile = (_file, _args, _options, callback) => {
      callback(Object.assign(new Error("not found"), { code: "ENOENT" }), "", "");
    };

    await expect(probeBinaryVersion("/missing/deslop-lsp", { execFile })).resolves.toBeUndefined();
  });

  it("retries once after a timeout and succeeds on the second attempt (issue #6)", async () => {
    const timeouts: Array<number | undefined> = [];
    let attempt = 0;
    const execFile: ExecFile = (_file, _args, options, callback) => {
      attempt += 1;
      timeouts.push(options.timeout);
      if (attempt === 1) {
        callback(Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" }), "", "");
        return;
      }
      callback(null, "napper 0.12.2\n", "");
    };

    await expect(probeBinaryVersion("/ext/bin/win32-x64/napper.exe", { execFile })).resolves.toEqual({
      name: "napper",
      version: "0.12.2"
    });
    expect(attempt).toBe(2);
    expect(timeouts[0]).toBe(10000);
  });

  it("does not retry when the binary is missing (ENOENT) (issue #6)", async () => {
    let attempt = 0;
    const execFile: ExecFile = (_file, _args, _options, callback) => {
      attempt += 1;
      callback(Object.assign(new Error("not found"), { code: "ENOENT" }), "", "");
    };

    await expect(probeBinaryVersion("/missing/napper.exe", { execFile })).resolves.toBeUndefined();
    expect(attempt).toBe(1);
  });

  it("reports the structured failure reason via probeBinaryVersionResult (issue #5)", async () => {
    const timeoutExec: ExecFile = (_file, _args, _options, callback) => {
      callback(Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" }), "", "");
    };
    const missingExec: ExecFile = (_file, _args, _options, callback) => {
      callback(Object.assign(new Error("not found"), { code: "ENOENT" }), "", "");
    };
    const okExec: ExecFile = (_file, _args, _options, callback) => {
      callback(null, "napper 0.12.2\n", "");
    };

    await expect(probeBinaryVersionResult("/ext/napper.exe", { execFile: timeoutExec })).resolves.toMatchObject({
      ok: false,
      failure: { reason: "timeout", timedOut: true }
    });
    await expect(probeBinaryVersionResult("/missing/napper.exe", { execFile: missingExec })).resolves.toMatchObject({
      ok: false,
      failure: { reason: "not-found" }
    });
    await expect(probeBinaryVersionResult("/ext/napper.exe", { execFile: okExec })).resolves.toEqual({
      ok: true,
      version: { name: "napper", version: "0.12.2" }
    });
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
