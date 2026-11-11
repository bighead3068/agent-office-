import { copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const dist = new URL(".agent-office-runtime/codex-dist/", root);
const html = await readFile(new URL("index.html", root), "utf8");
const entry = '<script type="module" src="/src/main.tsx"></script>';

if (!html.includes(entry)) {
  throw new Error("Cannot find the Agent Office entry point in index.html");
}

await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ["src/main.tsx"],
  outdir: fileURLToPath(new URL("assets/", dist)),
  bundle: true,
  format: "esm",
  minify: true,
  jsx: "automatic",
});

const localHtml = html
  .replace(entry, '<script type="module" src="./assets/main.js"></script>')
  .replace("</head>", '  <link rel="stylesheet" href="./assets/main.css" />\n  </head>');
await Promise.all([
  writeFile(new URL("index.html", dist), localHtml),
  copyFile(new URL("public/favicon.svg", root), new URL("favicon.svg", dist)),
]);
console.log(`Agent Office static files: ${fileURLToPath(dist)}`);
