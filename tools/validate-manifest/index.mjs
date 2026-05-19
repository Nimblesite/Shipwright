#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const toolDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(toolDir, "..", "..");
const defaultSchemaPath = join(repoRoot, "schemas", "shipwright.schema.json");

function usage() {
  console.error("Usage: shipwright-validate-manifest [--schema <path>] <manifest-or-directory>...");
}

function parseArgs(argv) {
  const args = [...argv];
  let schemaPath = defaultSchemaPath;
  const targets = [];

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--schema") {
      const next = args.shift();
      if (!next) {
        throw new Error("--schema requires a path");
      }
      schemaPath = resolve(next);
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg?.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    targets.push(resolve(arg));
  }

  if (targets.length === 0) {
    throw new Error("At least one manifest path or directory is required");
  }

  return { schemaPath, targets };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function expandTargets(targets) {
  const files = [];
  for (const target of targets) {
    const stats = statSync(target);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(target).sort()) {
        if (entry.endsWith(".json")) {
          files.push(join(target, entry));
        }
      }
      continue;
    }
    files.push(target);
  }
  return files;
}

function formatErrors(validate) {
  return validate.errors
    .map((error) => {
      const location = error.instancePath || "/";
      return `${location} ${error.message}`;
    })
    .join("\n");
}

function main() {
  const { schemaPath, targets } = parseArgs(process.argv.slice(2));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const validate = ajv.compile(readJson(schemaPath));
  const manifestFiles = expandTargets(targets);
  let failed = false;

  for (const manifestFile of manifestFiles) {
    const manifest = readJson(manifestFile);
    if (!validate(manifest)) {
      failed = true;
      console.error(`${manifestFile}: invalid\n${formatErrors(validate)}`);
      continue;
    }
    console.log(`${manifestFile}: valid`);
  }

  if (failed) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  usage();
  console.error(error.message);
  process.exit(2);
}
