#!/usr/bin/env python3
"""Register one bot with the local Agent Office runtime.

Writes a user-only header file and a seat row. Prints the header path and a
report command. Never prints the token. Re-registering the same agent id
fails unless --rotate is set, and --rotate replaces the credential only when
the display name is unchanged.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import self_report_server as srv


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Register one Agent Office bot")
    parser.add_argument("--agent-id", required=True)
    parser.add_argument("--display-name", required=True)
    parser.add_argument("--runtime-dir", default="")
    parser.add_argument("--rotate", action="store_true")
    parser.add_argument("--url", default=f"http://127.0.0.1:{srv.OFFICE_PORT}/api/self-report")
    args = parser.parse_args(argv)
    runtime = Path(args.runtime_dir).expanduser() if args.runtime_dir else srv.default_runtime_dir()
    if srv.legacy_runtime(runtime):
        print("result=rejected", file=sys.stderr)
        print("error=runtime directory is reserved for a v0.1 receiver", file=sys.stderr)
        return 2
    try:
        result = srv.register_agent(
            runtime,
            args.agent_id,
            args.display_name,
            rotate=args.rotate,
            url=args.url,
        )
    except (OSError, ValueError) as error:
        print("result=rejected", file=sys.stderr)
        print(f"error={srv.redact(str(error))}", file=sys.stderr)
        return 2
    if not result.get("ok"):
        print("result=rejected", file=sys.stderr)
        print(f"error={result.get('error')}", file=sys.stderr)
        if result.get("headerFile"):
            print(f"header_file={result['headerFile']}")
        return 2
    print(f"result={'rotated' if result.get('rotated') else 'registered'}")
    print(f"agent_id={result['agentId']}")
    print(f"display_name={result['displayName']}")
    print(f"seat={result['seat']}")
    print(f"header_file={result['headerFile']}")
    print(f"runtime_dir={result['runtimeDir']}")
    print(f"report_command={result['reportCommand']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
