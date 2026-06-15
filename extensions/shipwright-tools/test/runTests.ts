import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index");
  const testWorkspace = path.resolve(__dirname, "../../test/fixtures/workspace");
  const testDataDir = path.resolve(__dirname, "../../.vscode-test/user-data");
  const testExtDir = path.resolve(__dirname, "../../.vscode-test/extensions");

  const vscodeExecutablePath = await downloadAndUnzipVSCode();
  const vscodeDir = path.dirname(vscodeExecutablePath);

  const hashDirs = fs.readdirSync(vscodeDir).filter((d) => {
    const cliJs = path.join(vscodeDir, d, "resources", "app", "out", "cli.js");
    return fs.existsSync(cliJs);
  });

  if (hashDirs.length === 0) {
    throw new Error("Could not find VS Code cli.js in hash directory");
  }

  const cliJs = path.join(vscodeDir, hashDirs[0], "resources", "app", "out", "cli.js");

  const args = [
    cliJs,
    testWorkspace,
    `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
    `--extensionTestsPath=${extensionTestsPath}`,
    `--user-data-dir=${testDataDir}`,
    `--extensions-dir=${testExtDir}`,
    "--disable-updates",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
    "--wait",
  ];

  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };

  console.log(`Workspace: ${testWorkspace}`);

  const code = await new Promise<number>((resolve, reject) => {
    const child = cp.spawn(vscodeExecutablePath, args, {
      stdio: "inherit",
      env,
    });
    child.on("error", reject);
    child.on("close", (c) => {
      resolve(c ?? 1);
    });
  });

  console.log(`Exit code: ${code}`);

  if (code !== 0) {
    throw new Error(`Tests failed with exit code ${code}`);
  }
}

main().catch((err: unknown) => {
  console.error("Failed to run tests:", err);
  process.exit(1);
});
