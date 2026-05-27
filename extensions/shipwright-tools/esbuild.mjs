import { build, context } from "esbuild";

const isWatch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  minify: !isWatch,
};

if (isWatch) {
  const ctx = await context(opts);
  await ctx.watch();
  // eslint-disable-next-line no-console -- build script, not extension code
  console.log("Watching for changes...");
} else {
  await build(opts);
}
