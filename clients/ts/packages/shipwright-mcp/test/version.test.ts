import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createMcpServerInfo,
  createVersionManifest,
  formatJsonVersion,
  formatPlainVersion,
  handleVersionArgs,
  type VersionSpec
} from "../src/index.js";

const spec: VersionSpec = {
  name: "tmc-server",
  version: "0.5.0",
  kind: "mcp",
  language: "typescript",
  buildTime: "2026-01-01T00:00:00Z",
  capabilities: ["version-flag", "version-flag-json", "mcp-server-info-version"],
  gitDirty: false,
  gitSha: "abc1234",
  product: "too-many-cooks",
  target: "all",
  toolchain: "node 24"
};

describe("@nimblesite/shipwright-mcp", () => {
  it("creates MCP serverInfo from package metadata", () => {
    expect(createMcpServerInfo({ name: "@scope/pkg", version: "0.5.0" }, "tmc-server")).toEqual({
      ok: true,
      value: { name: "tmc-server", version: "0.5.0" }
    });
  });

  it("formats plain --version output", () => {
    expect(formatPlainVersion(spec)).toEqual({ ok: true, value: "tmc-server 0.5.0\n" });
  });

  it("formats JSON --version output matching the fixture shape", () => {
    const rendered = formatJsonVersion(spec);
    expect(rendered.ok).toBe(true);
    expect(JSON.parse(rendered.value ?? "{}")).toEqual({
      manifestVersion: 1,
      name: "tmc-server",
      version: "0.5.0",
      kind: "mcp",
      language: "typescript",
      buildTime: "2026-01-01T00:00:00Z",
      capabilities: ["version-flag", "version-flag-json", "mcp-server-info-version"],
      gitDirty: false,
      gitSha: "abc1234",
      product: "too-many-cooks",
      target: "all",
      toolchain: "node 24"
    });
  });

  it("dispatches --version and --version --json without starting the server", () => {
    expect(handleVersionArgs(["--version"], spec)).toEqual({
      ok: true,
      value: { handled: true, stdout: "tmc-server 0.5.0\n" }
    });
    expect(handleVersionArgs(["--version", "--json"], spec).value?.handled).toBe(true);
  });

  it("matches the checked-in node version fixtures", () => {
    const fixtureText = readFileSync(
      new URL("../../../../../fixtures/version-outputs/node/tmc-server.txt", import.meta.url),
      "utf8"
    );
    const fixtureJson = JSON.parse(
      readFileSync(new URL("../../../../../fixtures/version-outputs/node/tmc-server.json", import.meta.url), "utf8")
    );
    expect(formatPlainVersion(spec).value).toBe(fixtureText);
    expect(createVersionManifest(spec).value).toMatchObject(fixtureJson);
  });
});
