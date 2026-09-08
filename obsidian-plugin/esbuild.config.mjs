/*
 * Obsidian plugins ship as a single CommonJS file next to their manifest.
 *
 * `obsidian` and the editor packages are provided by the app at runtime, so
 * they are marked external - bundling them would both bloat the file and break
 * the instanceof checks the API relies on.
 */
import esbuild from "esbuild";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  target: "es2022",
  platform: "browser",
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    "node:*",
  ],
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
