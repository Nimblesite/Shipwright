import { describe, expect, it } from "vitest";
import {
  envPath,
  executableName,
  exeSuffix,
  joinBinary,
  pathCandidate,
  platformSeparator,
  type ResolveInput
} from "../src/index.js";

// ── platformSeparator ────────────────────────────────────────────────

describe("platformSeparator", () => {
  it("returns backslash for win32-x64", () => {
    expect(platformSeparator("win32-x64")).toBe("\\");
  });

  it("returns backslash for win32-arm64", () => {
    expect(platformSeparator("win32-arm64")).toBe("\\");
  });

  it("returns forward slash for darwin-arm64", () => {
    expect(platformSeparator("darwin-arm64")).toBe("/");
  });

  it("returns forward slash for darwin-x64", () => {
    expect(platformSeparator("darwin-x64")).toBe("/");
  });

  it("returns forward slash for linux-x64", () => {
    expect(platformSeparator("linux-x64")).toBe("/");
  });

  it("returns forward slash for linux-arm64", () => {
    expect(platformSeparator("linux-arm64")).toBe("/");
  });
});

// ── exeSuffix ────────────────────────────────────────────────────────

describe("exeSuffix", () => {
  it("returns .exe for win32-x64", () => {
    expect(exeSuffix("win32-x64")).toBe(".exe");
  });

  it("returns .exe for win32-arm64", () => {
    expect(exeSuffix("win32-arm64")).toBe(".exe");
  });

  it("returns empty string for darwin-arm64", () => {
    expect(exeSuffix("darwin-arm64")).toBe("");
  });

  it("returns empty string for linux-x64", () => {
    expect(exeSuffix("linux-x64")).toBe("");
  });
});

// ── executableName ───────────────────────────────────────────────────

describe("executableName", () => {
  it("appends .exe on win32-x64", () => {
    expect(executableName("basilisk", "win32-x64")).toBe("basilisk.exe");
  });

  it("appends .exe on win32-arm64", () => {
    expect(executableName("basilisk", "win32-arm64")).toBe("basilisk.exe");
  });

  it("returns bare name on darwin-arm64", () => {
    expect(executableName("basilisk", "darwin-arm64")).toBe("basilisk");
  });

  it("returns bare name on linux-x64", () => {
    expect(executableName("basilisk", "linux-x64")).toBe("basilisk");
  });
});

// ── joinBinary ───────────────────────────────────────────────────────
// THE critical function. Every path through this must be tested on every
// platform variant.

describe("joinBinary", () => {
  // ── Windows (backslash) ──────────────────────────────────────────

  it("joins Windows backslash dir with backslash separator on win32-x64", () => {
    const result = joinBinary("C:\\ext\\bin\\win32-x64", "basilisk", "win32-x64");
    expect(result).toBe("C:\\ext\\bin\\win32-x64\\basilisk.exe");
    expect(result).not.toContain("/");
  });

  it("joins Windows backslash dir with backslash separator on win32-arm64", () => {
    const result = joinBinary("C:\\ext\\bin\\win32-arm64", "basilisk", "win32-arm64");
    expect(result).toBe("C:\\ext\\bin\\win32-arm64\\basilisk.exe");
    expect(result).not.toContain("/");
  });

  it("does not double-separate when Windows dir has trailing backslash", () => {
    const result = joinBinary("C:\\ext\\bin\\", "basilisk", "win32-x64");
    expect(result).toBe("C:\\ext\\bin\\basilisk.exe");
    expect(result).not.toContain("\\\\basilisk");
  });

  it("does not double-separate when Windows dir has trailing forward slash", () => {
    const result = joinBinary("C:\\ext\\bin/", "basilisk", "win32-x64");
    expect(result).toBe("C:\\ext\\bin/basilisk.exe");
    expect(result).not.toContain("//basilisk");
    expect(result).not.toContain("\\/basilisk");
  });

  it("handles long Windows extension path (the Basilisk bug)", () => {
    const dir = "C:\\Users\\chris\\.vscode\\extensions\\nimblesite.basilisk-0.2.1\\bin\\win32-x64";
    const result = joinBinary(dir, "basilisk", "win32-x64");
    expect(result).toBe(`${dir}\\basilisk.exe`);
    expect(result).not.toContain("/");
    expect(result).toMatch(/\\basilisk\.exe$/);
  });

  // ── macOS/Linux (forward slash) ──────────────────────────────────

  it("joins Unix dir with forward slash separator on darwin-arm64", () => {
    const result = joinBinary("/ext/bin/darwin-arm64", "basilisk", "darwin-arm64");
    expect(result).toBe("/ext/bin/darwin-arm64/basilisk");
    expect(result).not.toContain("\\");
    expect(result).not.toContain(".exe");
  });

  it("joins Unix dir with forward slash separator on linux-x64", () => {
    const result = joinBinary("/ext/bin/linux-x64", "basilisk", "linux-x64");
    expect(result).toBe("/ext/bin/linux-x64/basilisk");
    expect(result).not.toContain("\\");
    expect(result).not.toContain(".exe");
  });

  it("does not double-separate when Unix dir has trailing slash", () => {
    const result = joinBinary("/ext/bin/", "basilisk", "darwin-arm64");
    expect(result).toBe("/ext/bin/basilisk");
    expect(result).not.toContain("//basilisk");
  });

  it("handles empty directory string", () => {
    const result = joinBinary("", "basilisk", "darwin-arm64");
    expect(result).toBe("basilisk");
  });

  // ── Cross-check: Windows path NEVER produces forward-slash join ──

  it("NEVER produces mixed separators for win32-x64", () => {
    const dirs = [
      "C:\\ext\\bin\\win32-x64",
      "C:\\Users\\dev\\.vscode\\extensions\\test-0.1.0\\bin\\win32-x64",
      "D:\\Program Files\\tool\\bin",
    ];
    for (const dir of dirs) {
      const result = joinBinary(dir, "tool", "win32-x64");
      const lastSep = result.lastIndexOf("\\");
      const lastFwd = result.lastIndexOf("/");
      expect(lastSep).toBeGreaterThan(lastFwd);
      expect(result).toMatch(/\\tool\.exe$/);
    }
  });

  it("NEVER produces backslash join for Unix platforms", () => {
    const dirs = [
      "/ext/bin/darwin-arm64",
      "/home/user/.vscode/extensions/test-0.1.0/bin/linux-x64",
      "/usr/local/bin",
    ];
    for (const dir of dirs) {
      const resultDarwin = joinBinary(dir, "tool", "darwin-arm64");
      expect(resultDarwin).not.toContain("\\");
      expect(resultDarwin).toMatch(/\/tool$/);

      const resultLinux = joinBinary(dir, "tool", "linux-x64");
      expect(resultLinux).not.toContain("\\");
      expect(resultLinux).toMatch(/\/tool$/);
    }
  });
});

// ── pathCandidate ────────────────────────────────────────────────────

describe("pathCandidate", () => {
  it("returns entry unchanged when it already ends with the binary (forward slash)", () => {
    expect(pathCandidate("/usr/local/bin/tool", "tool", "darwin-arm64")).toBe("/usr/local/bin/tool");
  });

  it("returns entry unchanged when it already ends with the binary (backslash)", () => {
    expect(pathCandidate("C:\\bin\\tool.exe", "tool", "win32-x64")).toBe("C:\\bin\\tool.exe");
  });

  it("appends binary name with backslash on Windows directory", () => {
    const result = pathCandidate("C:\\Users\\dev\\bin", "tool", "win32-x64");
    expect(result).toBe("C:\\Users\\dev\\bin\\tool.exe");
    expect(result).not.toContain("/tool");
  });

  it("appends binary name with forward slash on Unix directory", () => {
    const result = pathCandidate("/usr/local/bin", "tool", "darwin-arm64");
    expect(result).toBe("/usr/local/bin/tool");
    expect(result).not.toContain("\\");
  });

  it("returns bare binary name when entry equals executable name", () => {
    expect(pathCandidate("tool.exe", "tool", "win32-x64")).toBe("tool.exe");
  });
});

// ── envPath ──────────────────────────────────────────────────────────

describe("envPath", () => {
  it("returns pathVar value directly when set", () => {
    const input: ResolveInput = {
      binaryName: "tool",
      expectedVersion: "1.0.0",
      sources: ["env"],
      env: { TOOL_PATH: "C:\\custom\\tool.exe" },
      envConfig: { pathVar: "TOOL_PATH" }
    };
    expect(envPath(input, "win32-x64")).toBe("C:\\custom\\tool.exe");
  });

  it("joins dirVar with backslash on Windows", () => {
    const input: ResolveInput = {
      binaryName: "tool",
      expectedVersion: "1.0.0",
      sources: ["env"],
      env: { TOOL_DIR: "C:\\tools\\bin" },
      envConfig: { dirVar: "TOOL_DIR" }
    };
    const result = envPath(input, "win32-x64");
    expect(result).toBe("C:\\tools\\bin\\tool.exe");
    expect(result).not.toContain("/tool");
  });

  it("joins dirVar with forward slash on Unix", () => {
    const input: ResolveInput = {
      binaryName: "tool",
      expectedVersion: "1.0.0",
      sources: ["env"],
      env: { TOOL_DIR: "/opt/tools/bin" },
      envConfig: { dirVar: "TOOL_DIR" }
    };
    const result = envPath(input, "darwin-arm64");
    expect(result).toBe("/opt/tools/bin/tool");
    expect(result).not.toContain("\\");
  });

  it("returns undefined when neither pathVar nor dirVar is configured", () => {
    const input: ResolveInput = {
      binaryName: "tool",
      expectedVersion: "1.0.0",
      sources: ["env"],
      env: {}
    };
    expect(envPath(input, "win32-x64")).toBeUndefined();
  });

  it("returns undefined when dirVar is configured but env value is missing", () => {
    const input: ResolveInput = {
      binaryName: "tool",
      expectedVersion: "1.0.0",
      sources: ["env"],
      env: {},
      envConfig: { dirVar: "TOOL_DIR" }
    };
    expect(envPath(input, "win32-x64")).toBeUndefined();
  });
});
