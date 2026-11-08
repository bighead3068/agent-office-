#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
npm run build
stage="$(mktemp -d)"
pkg="$stage/agent-office-self-report"
mkdir -p "$pkg/receiver" "$pkg/dist" "$root/packaging"
cp -a dist/. "$pkg/dist/"
cp receiver/self_report_server.py "$pkg/receiver/self_report_server.py"
cp receiver/Start-AgentOffice.ps1 "$pkg/Start-AgentOffice.ps1"
cp receiver/README-BOX.md "$pkg/README-BOX.md"
if grep -R -n -E 'Bearer [A-Za-z0-9_-]{20,}|token_urlsafe\(' "$pkg/dist" "$pkg/Start-AgentOffice.ps1" "$pkg/README-BOX.md"; then
  echo "package contains a token-like string" >&2
  exit 1
fi
find "$pkg" -name node_modules -o -name .env -o -name 'token' -o -name '*.token' | grep -q . && {
  echo "package contains secrets or dependencies" >&2
  exit 1
} || true
( cd "$stage" && zip -r -X "$root/packaging/agent-office-self-report-box.zip" agent-office-self-report )
cp "$root/packaging/agent-office-self-report-box.zip" /opt/cursor/artifacts/agent-office-self-report-box.zip
rm -rf "$stage"
echo "wrote packaging/agent-office-self-report-box.zip"
