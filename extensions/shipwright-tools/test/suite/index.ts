import * as path from "path";
import * as fs from "fs";
import Mocha from "mocha";

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", timeout: 60_000, color: true });
  const testsRoot = __dirname;

  return new Promise((resolve, reject) => {
    const files = fs.readdirSync(testsRoot).filter((f) => f.endsWith(".test.js"));
    for (const f of files) {
      mocha.addFile(path.resolve(testsRoot, f));
    }

    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
