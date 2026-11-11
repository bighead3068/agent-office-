import { spawnSync } from "node:child_process"
import path from "node:path"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3")
const result = spawnSync(python, ["receiver/register_agent.py", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
})
process.exit(result.status ?? 1)
