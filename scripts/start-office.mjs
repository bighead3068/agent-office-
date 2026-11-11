import { createHash } from "node:crypto"
import { execFileSync, spawn } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const host = "127.0.0.1"
const port = Number(process.env.OFFICE_PORT || 8795)
const retired = new Set([8792, 8793, 8794])

function runtimeDir() {
  if (process.env.OFFICE_RUNTIME_DIR) return path.resolve(process.env.OFFICE_RUNTIME_DIR)
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || homedir(), "agent-office")
  const base = process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share")
  return path.join(base, "agent-office")
}

function pythonBin() {
  return process.env.PYTHON || (process.platform === "win32" ? "python" : "python3")
}

function fail(message) {
  console.error(message)
  process.exit(2)
}

function preflight() {
  const major = Number(process.versions.node.split(".")[0])
  if (!Number.isFinite(major) || major < 20) fail("需要 Node.js 20 以上。")
  if (retired.has(port)) fail(`埠 ${port} 是 v0.1 舊埠，不再服務。請用 8795。`)
  if (!existsSync(path.join(root, "node_modules", "esbuild"))) {
    fail("找不到依賴。請在這個資料夾執行 npm ci。")
  }
  let version = ""
  try {
    version = execFileSync(pythonBin(), ["--version"], { encoding: "utf8" })
  } catch {
    fail("找不到 Python。請安裝 Python 3.10 以上，或設定 PYTHON。")
  }
  const match = version.match(/Python (\d+)\.(\d+)/)
  if (!match || Number(match[1]) < 3 || (Number(match[1]) === 3 && Number(match[2]) < 10)) {
    fail("需要 Python 3.10 以上。")
  }
}

async function health() {
  try {
    const response = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(800) })
    if (!response.ok) return { wrong: true }
    return await response.json()
  } catch {
    return null
  }
}

function openBrowser(url) {
  if (process.env.OFFICE_NO_BROWSER === "1") return
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open"
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url]
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" })
    child.on("error", () => console.error("無法自動開啟瀏覽器。請自行打開上面的網址。"))
    child.unref()
  } catch {
    console.error("無法自動開啟瀏覽器。請自行打開上面的網址。")
  }
}

function runtimeMarker(runtime) {
  let text = path.resolve(runtime)
  try {
    text = realpathSync(runtime)
  } catch {
    // The directory may not exist until the receiver creates it.
  }
  return createHash("sha256").update(text).digest("hex").slice(0, 16)
}

function report(runtime, already) {
  console.log(already ? "already_running=yes" : "already_running=no")
  console.log(`ui=http://${host}:${port}/`)
  console.log(`runtime_dir=${runtime}`)
  console.log(`runtime_marker=${runtimeMarker(runtime)}`)
  if (already) console.log("note=did not start a second process")
  console.log("token_not_printed=yes")
  console.log("get_auth=loopback-only-no-token")
}

preflight()
const runtime = runtimeDir()
const current = await health()
if (current?.ok === true && current.service === "agent-office") {
  const marker = runtimeMarker(runtime)
  if (!current.runtimeMarker || current.runtimeMarker !== marker) {
    console.log(`runtime_dir=${runtime}`)
    fail("已在跑的接收器使用另一個 runtime。沒有啟動第二個行程。")
  }
  report(runtime, true)
  openBrowser(`http://${host}:${port}/`)
  process.exit(0)
}
if (current) fail(`埠 ${port} 已被其他程式占用。Agent Office 不會自動換埠。`)

execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" })
const child = spawn(pythonBin(), [
  "-u",
  "receiver/self_report_server.py",
  "--host",
  host,
  "--port",
  String(port),
  "--runtime-dir",
  runtime,
  "--static-dir",
  "dist",
], { cwd: root, stdio: "inherit" })

let ready = false
for (let attempt = 0; attempt < 50; attempt += 1) {
  await delay(200)
  if (child.exitCode != null) process.exit(child.exitCode)
  const seen = await health()
  if (seen?.ok === true && seen.service === "agent-office") {
    ready = true
    break
  }
}
if (!ready) {
  child.kill()
  fail("接收器沒有在期限內通過 /health。")
}
report(runtime, false)
openBrowser(`http://${host}:${port}/`)
child.on("exit", (code) => process.exit(code ?? 0))
