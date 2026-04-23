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

function toResolveInput(input: Record<string, unknown>, probeMap: Record<string, ProbedVersion>): ResolveInput {
  return {
    binaryName: deriveBinaryName(input.expectedName as string | undefined, probeMap),
    expectedName: input.expectedName as string | undefined,
    expectedVersion: input.expectedVersion as string,
    sources: input.sources as ResolveInput["sources"],
    platform: input.platform as ResolveInput["platform"],
    userSettingPath: input.userSettingPath as string | null | undefined,
    env: (input.env ?? {}) as Record<string, string>,
    envConfig: input.envConfig as ResolveInput["envConfig"],
    path: input.path as string[] | undefined,
    bundledDir: input.bundledDir as string | null | undefined,
    cargoBin: input.cargoBin as string | undefined,
    pkgmgr: input.pkgmgr as ResolveInput["pkgmgr"],
    dotnetTool: input.dotnetTool as ResolveInput["dotnetTool"]
  };
}

function deriveBinaryName(expectedName: string | undefined, probeMap: Record<string, ProbedVersion>): string {
  if (expectedName) return expectedName;
  return Object.values(probeMap)[0]?.name ?? "deslop-lsp";
}
