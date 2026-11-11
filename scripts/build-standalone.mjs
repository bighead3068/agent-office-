import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const dist = path.join(root, "dist")
let html = await readFile(path.join(dist, "index.html"), "utf8")
const script = html.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/)
const link = html.match(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/)
if (!script || !link) throw new Error("dist/index.html is missing the built script or stylesheet")

const cssPath = path.join(dist, link[1].replace(/^\.\//, ""))
const jsPath = path.join(dist, script[1].replace(/^\.\//, ""))
let css = await readFile(cssPath, "utf8")
const js = await readFile(jsPath, "utf8")

css = await inlineCssUrls(css, path.dirname(cssPath))
html = html
  .replace(link[0], `<style>\n${css}\n</style>`)
  .replace(script[0], `<script type="module">\n${js}\n</script>`)
html = await inlineHtmlFiles(html, dist)
const external = [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((match) => match[1])
const remote = external.filter((value) => !value.startsWith("data:") && !value.startsWith("#"))
if (remote.length > 0) throw new Error(`standalone still references files: ${remote.join(", ")}`)
await writeFile(path.join(root, "standalone.html"), html)
console.log("wrote standalone.html")

async function inlineHtmlFiles(source, fromDir) {
  const pattern = /\s(?:src|href)="(?!data:|#)([^"]+)"/g
  let next = ""
  let cursor = 0
  for (const match of source.matchAll(pattern)) {
    const file = path.join(fromDir, match[1].replace(/^\.\//, ""))
    const bytes = await readFile(file)
    const type = file.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream"
    next += source.slice(cursor, match.index) + match[0].replace(match[1], `data:${type};base64,${bytes.toString("base64")}`)
    cursor = match.index + match[0].length
  }
  return next + source.slice(cursor)
}

async function inlineCssUrls(source, fromDir) {
  const pattern = /url\(([^)]+)\)/g
  let next = ""
  let cursor = 0
  for (const match of source.matchAll(pattern)) {
    const raw = match[1].replace(/["']/g, "").trim()
    next += source.slice(cursor, match.index)
    cursor = match.index + match[0].length
    if (raw.startsWith("data:") || raw.startsWith("#")) {
      next += match[0]
      continue
    }
    const file = path.resolve(fromDir, raw.split("?")[0])
    const bytes = await readFile(file)
    const type = file.endsWith(".ttf") ? "font/ttf" : file.endsWith(".woff2") ? "font/woff2" : "application/octet-stream"
    next += `url("data:${type};base64,${bytes.toString("base64")}")`
  }
  return next + source.slice(cursor)
}
