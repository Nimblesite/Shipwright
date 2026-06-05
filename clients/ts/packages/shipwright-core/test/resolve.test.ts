import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolve, type ProbedVersion, type ResolveInput } from "../src/index.js";

interface Vector {
  id: string;
  input: Record<string, unknown>;
  expect: Record<string, unknown>;
}

const vectorsPath = new URL("../../../../../schemas/test-vectors.json", import.meta.url);
const vectorDoc = JSON.parse(readFileSync(vectorsPath, "utf8")) as { vectors: Vector[] };

describe("resolve", () => {
  for (const vector of vectorDoc.vectors) {
    it(vector.id, () => {
      const probeMap = (vector.input.probe ?? {}) as Record<string, ProbedVersion>;
      const input = toResolveInput(vector.input, probeMap);
      const result = resolve(input, (path) => probeMap[path]);

      for (const [key, expectedValue] of Object.entries(vector.expect)) {
        expect(result[key as keyof typeof result]).toEqual(expectedValue);
      }
    });
  }
});

describe("resolve issue #5 — preserves the attempted candidate path on probe failure", () => {
  it("returns the bundled candidate path (not null) when the probe fails", () => {
    const input: ResolveInput = {
      binaryName: "napper",
      expectedName: "napper",
      expectedVersion: "0.12.2",
      sources: ["bundled"],
      platform: "darwin-arm64",
      bundledDir: "/ext/bin/darwin-arm64"
    };

    const result = resolve(input, () => undefined);

    expect(result.errorCode).toBe("no-source-resolved");
    expect(result.path).toBe("/ext/bin/darwin-arm64/napper");
    expect(result.errorDetails?.at).toBe("/ext/bin/darwin-arm64/napper");
    expect(result.errorDetails?.attempted).toEqual([{ source: "bundled", path: "/ext/bin/darwin-arm64/napper" }]);
  });

  it("records every attempted source and reports the last as the path", () => {
    const input: ResolveInput = {
      binaryName: "napper",
      expectedName: "napper",
      expectedVersion: "0.12.2",
      sources: ["path", "bundled"],
      platform: "darwin-arm64",
      path: ["/usr/local/bin"],
      bundledDir: "/ext/bin/darwin-arm64"
    };

    const result = resolve(input, () => undefined);

    expect(result.errorCode).toBe("no-source-resolved");
    expect(result.errorDetails?.attempted).toEqual([
      { source: "path", path: "/usr/local/bin/napper" },
      { source: "bundled", path: "/ext/bin/darwin-arm64/napper" }
    ]);
    expect(result.path).toBe("/ext/bin/darwin-arm64/napper");
  });

  it("still reports a null path when no source produced a candidate to try", () => {
    const input: ResolveInput = {
      binaryName: "napper",
      expectedName: "napper",
      expectedVersion: "0.12.2",
      sources: ["bundled"],
      platform: "darwin-arm64",
      bundledDir: null
    };

    const result = resolve(input, () => undefined);

    expect(result.errorCode).toBe("no-source-resolved");
    expect(result.path).toBe(null);
    expect(result.errorDetails).toBeUndefined();
  });
});

function toResolveInput(input: Record<string, unknown>, probeMap: Record<string, ProbedVersion>): ResolveInput {
  const expectedName = input.expectedName as string | undefined;
  const resolved: ResolveInput = {
    binaryName: deriveBinaryName(expectedName, probeMap),
    expectedVersion: input.expectedVersion as string,
    sources: input.sources as ResolveInput["sources"],
    env: (input.env ?? {}) as Record<string, string>
  };

  if (expectedName !== undefined) resolved.expectedName = expectedName;
  if (input.platform !== undefined) resolved.platform = input.platform as NonNullable<ResolveInput["platform"]>;
  if (input.userSettingPath !== undefined) resolved.userSettingPath = input.userSettingPath as string | null;
  if (input.envConfig !== undefined) resolved.envConfig = input.envConfig as NonNullable<ResolveInput["envConfig"]>;
  if (input.path !== undefined) resolved.path = input.path as string[];
  if (input.bundledDir !== undefined) resolved.bundledDir = input.bundledDir as string | null;
  if (input.cargoBin !== undefined) resolved.cargoBin = input.cargoBin as string;
  if (input.pkgmgr !== undefined) resolved.pkgmgr = input.pkgmgr as NonNullable<ResolveInput["pkgmgr"]>;
  if (input.dotnetTool !== undefined) resolved.dotnetTool = input.dotnetTool as NonNullable<ResolveInput["dotnetTool"]>;

  return resolved;
}

function deriveBinaryName(expectedName: string | undefined, probeMap: Record<string, ProbedVersion>): string {
  if (expectedName) return expectedName;
  return Object.values(probeMap)[0]?.name ?? "deslop-lsp";
}
