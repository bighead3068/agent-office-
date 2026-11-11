#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
npm run build
stage="$(mktemp -d)"
pkg="$stage/agent-office-multi-report"
mkdir -p "$pkg/receiver" "$pkg/dist" "$root/packaging"
cp -a dist/. "$pkg/dist/"
cp receiver/self_report_server.py receiver/report_task.py receiver/codex_activity.py "$pkg/receiver/"
cp receiver/Start-MultiReport.ps1 "$pkg/Start-MultiReport.ps1"
cp receiver/README-MULTI.md "$pkg/README-MULTI.md"
if grep -R -n -E 'Bearer [A-Za-z0-9_-]{20,}' "$pkg/dist" "$pkg/Start-MultiReport.ps1" "$pkg/README-MULTI.md"; then
  echo "package contains a token-like string" >&2
  exit 1
fi
rm -f "$root/packaging/agent-office-multi-report-box.zip"
( cd "$stage" && zip -r -X "$root/packaging/agent-office-multi-report-box.zip" agent-office-multi-report )
cp "$root/packaging/agent-office-multi-report-box.zip" /opt/cursor/artifacts/agent-office-multi-report-box.zip
rm -rf "$stage"
echo "wrote packaging/agent-office-multi-report-box.zip"
