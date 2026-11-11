#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
npm run build
stage="$(mktemp -d)"
mkdir -p "$stage/receiver" "$stage/dist" "$root/packaging"
cp Start-AgentOffice.ps1 README.md ASSETS.md "$stage/"
cp receiver/self_report_server.py receiver/report_task.py receiver/report_activity.py receiver/register_agent.py receiver/codex_activity.py "$stage/receiver/"
cp -a dist/. "$stage/dist/"
if grep -R -n -E 'Bearer [A-Za-z0-9_-]{20,}' "$stage/dist" "$stage/Start-AgentOffice.ps1" "$stage/README.md" "$stage/ASSETS.md"; then
  echo "package contains a token-like string" >&2
  exit 1
fi
rm -f "$root/packaging/agent-office-v0.2.zip"
( cd "$stage" && zip -r -X "$root/packaging/agent-office-v0.2.zip" . )
python3 - <<'PY' "$root/packaging/agent-office-v0.2.zip"
import sys, zipfile
names = zipfile.ZipFile(sys.argv[1]).namelist()
if any(name.startswith("agent-office/") for name in names):
    raise SystemExit("zip has a nested folder")
if "Start-AgentOffice.ps1" not in names or "receiver/self_report_server.py" not in names:
    raise SystemExit("zip is missing the launcher or receiver")
print("zip entries", len(names))
PY
mkdir -p /opt/cursor/artifacts
cp "$root/packaging/agent-office-v0.2.zip" /opt/cursor/artifacts/agent-office-v0.2.zip
rm -rf "$stage"
echo "wrote packaging/agent-office-v0.2.zip"
